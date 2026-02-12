import base64
import os
import re
import shutil
import socket
import sys
import uuid
import io
import json
import zipfile
import subprocess
import traceback
from datetime import datetime
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

import tldextract
import uvicorn
import yaml
from PIL import Image
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from core.base_handler import HandlerRegistry
from core.data_reader_db import DbDataReader
from core.logger import setup_logger
from core.template_manager import TemplateManager
from core.report_merger import ReportMerger

logger = setup_logger('API')

if getattr(sys, 'frozen', False):
    # PyInstaller 打包后的路径处理
    # 目录模式: resources/backend/dist/api/api.exe
    # 需要往上跳两级到 resources/backend/
    EXE_PATH = sys.executable
    EXE_DIR = os.path.dirname(EXE_PATH)  # dist/api/
    BASE_DIR = os.path.dirname(os.path.dirname(EXE_DIR))  # backend/
else:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))

CONF_PATH = os.path.join(BASE_DIR, "config.yaml")
SHARED_CONF_PATH = os.path.join(BASE_DIR, "shared-config.json")

def load_config():
    if not os.path.exists(CONF_PATH):
        raise FileNotFoundError(f"Config file not found at {CONF_PATH}")
    with open(CONF_PATH, 'r', encoding='utf-8') as f:
        return yaml.safe_load(f)

def load_shared_config():
    """加载共享配置（服务器端口等）"""
    if os.path.exists(SHARED_CONF_PATH):
        with open(SHARED_CONF_PATH, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {"server": {"host": "127.0.0.1", "port": 8000}}

config = load_config()
shared_config = load_shared_config()

# 延迟初始化：提升 macOS 启动速度
# 这些变量在首次访问时才会加载数据
_db_reader = None
_cached_vuln_list = None
_cached_vulnerabilities = None
_cached_icp_infos = None
_template_manager = None

TEMPLATES_BASE_DIR = os.path.join(BASE_DIR, "templates")
TEMPLATES_DIR = TEMPLATES_BASE_DIR  # 模板根目录
TEMPLATES_DELETED_DIR = os.path.join(TEMPLATES_BASE_DIR, "_deleted")  # 已删除模板备份目录（隐藏）


def get_db_reader():
    """延迟初始化数据库读取器"""
    global _db_reader
    if _db_reader is None:
        _db_reader = DbDataReader(
            db_path=os.path.join(BASE_DIR, config["vul_or_icp"])
        )
    return _db_reader


def get_cached_vulnerabilities():
    """延迟加载漏洞缓存"""
    global _cached_vuln_list, _cached_vulnerabilities
    if _cached_vuln_list is None or _cached_vulnerabilities is None:
        return reload_vulnerabilities_cache()
    return _cached_vuln_list, _cached_vulnerabilities


def get_cached_icp_infos():
    """延迟加载 ICP 备案缓存"""
    global _cached_icp_infos
    if _cached_icp_infos is None:
        return reload_icp_cache()
    return _cached_icp_infos


def reload_vulnerabilities_cache():
    """重新加载漏洞缓存"""
    global _cached_vuln_list, _cached_vulnerabilities
    _cached_vuln_list, _cached_vulnerabilities = get_db_reader().read_vulnerabilities_from_db()
    return _cached_vuln_list, _cached_vulnerabilities


def reload_icp_cache():
    """重新加载 ICP 缓存"""
    global _cached_icp_infos
    _cached_icp_infos = get_db_reader().read_Icp_from_db()
    return _cached_icp_infos


def get_template_manager():
    """
    延迟初始化模板管理器
    
    模板管理器会自动扫描 templates/ 目录并动态加载所有 handler.py
    无需手动导入（阶段 1：任务 1.4）
    """
    global _template_manager
    if _template_manager is None:
        _template_manager = TemplateManager(TEMPLATES_DIR, config)
        
        # 动态挂载模板路由
        for template_id, router in _template_manager.get_template_routers().items():
            # Security Fix: 强制路由隔离，防止模板覆盖系统API或越权
            # 所有模板定义的 API 必须通过 /api/plugin/{template_id}/ 访问
            safe_prefix = f"/api/plugin/{template_id}"
            app.include_router(
                router, 
                prefix=safe_prefix,
                tags=[f"Plugin: {template_id}"]
            )
            logger.info(f"Mounted router for template: {template_id} at {safe_prefix}")
            
        # 输出已注册的 Handler（由动态加载自动注册）
        logger.info(f"Registered handlers: {HandlerRegistry.list_registered()}")
    return _template_manager


# 为了兼容性，保留全局变量别名
# 注意：直接赋值的地方需要使用 reload_xxx_cache() 函数


class ConfigResponse(BaseModel):
    """返回给前端的初始化配置信息"""
    version: str
    supplierName: str
    hazard_types: List[str]
    unit_types: List[str]
    industries: List[str]
    vulnerabilities_list: List[Dict[str, str]]


class UrlProcessRequest(BaseModel):
    url: str

class UrlProcessResponse(BaseModel):
    url: str
    domain: str
    ip: str
    icp_info: Optional[Dict[str, Any]] = None

class CustomVulnRequest(BaseModel):
    name: str
    category: Optional[str] = ""
    port: Optional[str] = ""
    level: str
    basis: Optional[str] = ""
    description: str
    impact: Optional[str] = ""
    suggestion: str

class UploadImageRequest(BaseModel):
    image_base64: str
    filename: Optional[str] = "image.png"

class UploadImageResponse(BaseModel):
    file_path: str
    url: str

class VulnEvidence(BaseModel):
    path: str
    description: str = ""

class ReportRequest(BaseModel):
    """生成报告所需的所有字段"""
    vulnerability_id: str
    hazard_type: str
    hazard_level: str
    alert_level: str
    vul_name: str
    unit_type: str
    industry: str
    
    url: str
    website_name: str
    domain: str
    ip: str
    icp_number: str
    discovery_date: str
    
    vul_description: str
    vul_harm: str
    repair_suggestion: str
    remarks: str
    
    city: str
    region: str
    unit_name: str

    vuln_evidence_images: List[VulnEvidence] = []
    icp_screenshot_path: Optional[str] = None

class ReportResponse(BaseModel):
    success: bool
    report_path: str
    download_url: str
    message: str

class MergeRequest(BaseModel):
    files: List[str]
    output_filename: Optional[str] = "Merged_Report.docx"

class MergeResponse(BaseModel):
    success: bool
    message: str
    file_path: str
    download_url: str

class DeleteFileRequest(BaseModel):
    path: str

class IcpModel(BaseModel):
    domain: str
    unitName: str
    mainLicence: str
    updateTime: Optional[str] = ""

class IcpEntryRequest(BaseModel):
    unitName: Optional[str] = ""
    natureName: Optional[str] = ""
    domain: Optional[str] = ""
    mainLicence: Optional[str] = ""
    serviceLicence: Optional[str] = ""
    updateRecordTime: Optional[str] = ""

class BatchDeleteRequest(BaseModel):
    ids: List[str]

class UpdateConfigRequest(BaseModel):
    supplierName: str

app = FastAPI()

@app.on_event("startup")
async def startup_event():
    """应用启动时初始化模板管理器"""
    get_template_manager()
    logger.info("Template system initialized")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

OUTPUT_DIR = os.path.join(BASE_DIR, "output", "report")
if not os.path.exists(OUTPUT_DIR):
    os.makedirs(OUTPUT_DIR)
app.mount("/reports", StaticFiles(directory=OUTPUT_DIR), name="reports")

TEMP_DIR = os.path.join(BASE_DIR, "output", "temp")
if not os.path.exists(TEMP_DIR):
    os.makedirs(TEMP_DIR)
app.mount("/temp", StaticFiles(directory=TEMP_DIR), name="temp")


@app.get("/")
def read_root():
    return {"message": "ReportGenX Backend is Running", "version": config["version"]}

@app.get("/api/config", response_model=ConfigResponse)
def get_config():
    """获取初始化配置数据，填充前端下拉框"""
    def clean_list(lst):
        if not lst:
            return []
        return [str(item) for item in lst if item]

    return {
        "version": config["version"],
        "supplierName": config["supplierName"],
        "hazard_types": clean_list(config.get("hazard_type", [])),
        "unit_types": clean_list(config.get("unitType", [])),
        "industries": clean_list(config.get("industry", [])),
        "vulnerabilities_list": get_cached_vulnerabilities()[0]
    }

@app.get("/api/frontend-config")
def get_frontend_config():
    """获取前端全局配置（风险等级颜色等共享配置）"""
    return {
        "risk_levels": config.get("risk_levels", []),
        "operating_systems": config.get("operating_systems", []),
        "version": config["version"]
    }

@app.get("/api/backup-db")
def backup_database():
    """下载数据库备份"""
    db_path = os.path.join(BASE_DIR, config["vul_or_icp"])
    if os.path.exists(db_path):
        filename = f"backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.db"
        return FileResponse(path=db_path, filename=filename, media_type='application/x-sqlite3')
    raise HTTPException(status_code=404, detail="Database file not found")

@app.get("/api/vulnerability/{id_or_name}")
def get_vulnerability_detail(id_or_name: str):
    """根据 ID 或名称获取漏洞详情"""
    _, cached_vulns = get_cached_vulnerabilities()
    if id_or_name in cached_vulns:
        return cached_vulns[id_or_name]
    
    for v in cached_vulns.values():
        val_name = v.get('Vuln_Name')
        if val_name and (val_name == id_or_name or val_name.lower() == id_or_name.lower()):
            return v
    
    desc, sol = get_db_reader().get_vulnerability_info(id_or_name)
    if desc:
        return {
            "Vuln_Description": desc,
            "Repair_suggestions": sol,
            "Vuln_Name": id_or_name,
            "Vuln_data_source": "legacy_fallback"
        }

    return {"error": "Vulnerability not found"}

@app.post("/api/process-url", response_model=UrlProcessResponse)
def process_url(req: UrlProcessRequest):
    """处理输入的 URL/IP，解析域名和 IP，查找匹配的 ICP 备案信息"""
    text = req.url.strip()
    result = {
        "url": text,
        "domain": "",
        "ip": "",
        "icp_info": None
    }
    
    ip_pattern = r'^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$'
    
    if re.match(ip_pattern, text):
        result["ip"] = text
    else:
        extracted = tldextract.extract(text)
        if extracted.domain and extracted.suffix:
            result["domain"] = f"{extracted.domain}.{extracted.suffix}"
            full_domain = f"{extracted.subdomain}.{extracted.domain}.{extracted.suffix}" if extracted.subdomain else result["domain"]
            
            try:
                result["ip"] = socket.gethostbyname(full_domain)
            except (socket.gaierror, socket.herror, OSError):
                pass
        elif text.startswith('http'):
            try:
                parsed = urlparse(text)
                result["domain"] = parsed.netloc
            except (ValueError, AttributeError):
                pass

    if result["domain"]:
        domain_key = result["domain"].lower()
        cached_icp = get_cached_icp_infos()
        logger.debug(f"Looking for domain: {domain_key}")
        logger.debug(f"Available domains (first 10): {list(cached_icp.keys())[:10]}")
        
        if domain_key in cached_icp:
            result["icp_info"] = cached_icp[domain_key]
            logger.debug(f"Direct match found!")
        else:
            parts = domain_key.split('.')
            if len(parts) > 2:
                root_domain = f"{parts[-2]}.{parts[-1]}"
                logger.debug(f"Trying root domain: {root_domain}")
                if root_domain in cached_icp:
                    result["icp_info"] = cached_icp[root_domain]
                    logger.debug(f"Root domain match found!")
            
            if not result["icp_info"]:
                for cached_domain in cached_icp.keys():
                    if domain_key.endswith('.' + cached_domain) or domain_key == cached_domain:
                        result["icp_info"] = cached_icp[cached_domain]
                        logger.debug(f"Suffix match found: {cached_domain}")
                        break
        
        if not result["icp_info"]:
            logger.debug(f"No match found for: {domain_key}")
        else:
            info = result['icp_info']
            logger.debug(f"Found ICP info for: {domain_key}")
            logger.debug(f"unitName bytes: {repr(info.get('unitName', '').encode('utf-8'))}")

    return result

@app.post("/api/upload-image", response_model=UploadImageResponse)
def upload_image(req: UploadImageRequest):
    """接收 Base64 图片，保存为临时文件，返回绝对路径 (Security Fixed)"""
    try:
        if ',' in req.image_base64:
            header, encoded = req.image_base64.split(',', 1)
        else:
            encoded = req.image_base64

        data = base64.b64decode(encoded)
        
        # 安全检查 1: 文件大小限制 (10MB)
        if len(data) > 10 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="Image size exceeds 10MB limit")

        # 安全检查 2: 验证图片格式与完整性
        try:
            with Image.open(io.BytesIO(data)) as img:
                img.verify()  # 验证文件结构是否损坏
                
                # 重新打开以读取属性（verify后需重新打开）
                with Image.open(io.BytesIO(data)) as valid_img:
                    fmt = valid_img.format.lower()
                    
                    # 白名单格式检查
                    ALLOWED_FORMATS = {'png', 'jpeg', 'jpg', 'gif', 'bmp'}
                    if fmt not in ALLOWED_FORMATS:
                        raise HTTPException(status_code=400, detail=f"Unsupported image format: {fmt}")
                    
                    # 像素炸弹防护 (限制分辨率 10000x10000)
                    if valid_img.width * valid_img.height > 100000000:
                         raise HTTPException(status_code=400, detail="Image dimensions too large")
                        
                    # 确定安全的文件后缀
                    ext = f".{fmt}" if fmt != 'jpeg' else '.jpg'
        except Exception as e:
            if isinstance(e, HTTPException):
                raise e
            logger.warning(f"Invalid image upload attempt: {str(e)}")
            raise HTTPException(status_code=400, detail="Invalid image file")

        # 使用生成的安全文件名
        filename = f"{uuid.uuid4()}{ext}"
        file_path = os.path.join(TEMP_DIR, filename)
        
        with open(file_path, "wb") as f:
            f.write(data)
            
        return {
            "file_path": file_path,
            "url": f"/temp/{filename}"
        }
    except Exception as e:
        if isinstance(e, HTTPException):
            raise e
        logger.error(f"Upload failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/generate-report", response_model=ReportResponse)
def generate_report(req: ReportRequest):
    """
    生成报告的核心接口 (重构版：使用 VulnReportHandler)
    """
    try:
        # 获取漏洞报告处理器
        handler = HandlerRegistry.get_handler("vuln_report", get_template_manager(), config)
        if not handler:
            raise HTTPException(status_code=500, detail="VulnReportHandler not found")
            
        # 转换请求数据为字典
        data = req.dict()
        
        # 映射字段差异 (如果有)
        # ReportRequest 中的 icp_screenshot_path 对应 handler 中的 icp_screenshot
        data['icp_screenshot'] = req.icp_screenshot_path
        
        # 执行生成
        result = handler.run(data, OUTPUT_DIR)
        
        if result["success"]:
            # 生成下载 URL
            file_name = os.path.basename(result["report_path"])
            unit_name = data.get("unit_name", "Unknown")
            download_url = f"/reports/{unit_name}/{file_name}"
            
            return {
                "success": True,
                "report_path": result["report_path"],
                "download_url": download_url,
                "message": result["message"]
            }
        else:
            return {
                "success": False,
                "report_path": "",
                "download_url": "",
                "message": result["message"]
            }

    except Exception as e:
        traceback.print_exc()
        return {
            "success": False,
            "report_path": "",
            "download_url": "",
            "message": f"Error generating report: {str(e)}"
        }

@app.get("/api/vulnerabilities")
def get_vulnerabilities():
    """获取所有漏洞列表及其详情"""
    try:
        # 显式重载缓存，避免数据不一致
        _, cached_vulns = reload_vulnerabilities_cache()
        if not cached_vulns:
             return []
        
        # 将字典的值转换为列表返回
        return list(cached_vulns.values())
    except Exception as e:
        logger.error(f"Error fetching vulnerabilities: {e}")
        return []

@app.post("/api/vulnerabilities")
def add_vulnerability(vuln: CustomVulnRequest):
    """添加新漏洞"""
    try:
        success, msg = get_db_reader().add_vulnerability_to_db(vuln.dict())
        if not success:
            raise HTTPException(status_code=400, detail=msg)
    
        # 立即刷新缓存
        reload_vulnerabilities_cache()
        
        return {"success": True, "message": msg}
    except Exception as e:
        logger.error(f"Add vulnerability failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.put("/api/vulnerabilities/{Vuln_id}")
def update_vulnerability(Vuln_id: str, vuln: CustomVulnRequest):
    """更新漏洞信息"""
    try:
        success, msg = get_db_reader().update_vulnerability_in_db(Vuln_id, vuln.dict())
        if not success:
            raise HTTPException(status_code=400, detail=msg)

        reload_vulnerabilities_cache()

        return {"success": True, "message": msg}
    except Exception as e:
        logger.error(f"Update vulnerability failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/vulnerabilities/{Vuln_id}")
def delete_vulnerability(Vuln_id: str):
    """删除漏洞"""
    try:
        success, msg = get_db_reader().delete_vulnerability_from_db(Vuln_id)
        if not success:
             raise HTTPException(status_code=400, detail=msg)

        reload_vulnerabilities_cache()

        return {"success": True, "message": msg}
    except Exception as e:
        logger.error(f"Delete vulnerability failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/open-folder")
def open_folder(req: dict):
    """打开文件所在目录"""
    path = req.get("path")
    
    # 如果未指定路径，尝试打开配置中的默认输出目录 (Use output/report explicitly for consistency)
    if not path or path == "default":
        path = OUTPUT_DIR
    
    if not path:
        return {"success": False, "message": "No path provided"}
    
    path = os.path.normpath(path)
    
    if os.path.isfile(path):
        target_dir = os.path.dirname(path)
    elif os.path.exists(path) and os.path.isdir(path):
         target_dir = path
    else:
         # Try parent if path doesn't exist (maybe file deleted?)
         target_dir = os.path.dirname(path)
         if not os.path.exists(target_dir):
             return {"success": False, "message": "Path does not exist"}

    try:
        if os.name == 'nt':
            os.startfile(target_dir)
        else:
            if sys.platform == 'darwin':
                subprocess.Popen(['open', target_dir])
            else:
                subprocess.Popen(['xdg-open', target_dir])
        return {"success": True, "message": "Folder opened"}
    except Exception as e:
        return {"success": False, "message": str(e)}

@app.post("/api/merge-reports", response_model=MergeResponse)
def merge_reports(req: MergeRequest):
    """合并多个报告"""
    try:
        # 确定输出路径
        # 默认放到 output/report/合并报告 下
        MERGE_DIR = os.path.join(OUTPUT_DIR, "Combined")
        if not os.path.exists(MERGE_DIR):
            os.makedirs(MERGE_DIR)
            
        # 如果未指定文件名或为空，生成一个带时间戳的
        filename = req.output_filename or f"Merged_{datetime.now().strftime('%Y%m%d%H%M%S')}.docx"
        if not filename.endswith('.docx'):
            filename += '.docx'
            
        output_path = os.path.join(MERGE_DIR, filename)
        
        success, msg = ReportMerger.merge_reports(req.files, output_path)
        
        if success:
            return {
                "success": True,
                "message": "合并成功",
                "file_path": output_path,
                "download_url": "" # 暂不需要下载URL，本地打开即可
            }
        else:
            return {
                "success": False,
                "message": msg,
                "file_path": "",
                "download_url": ""
            }
    except Exception as e:
        return {
            "success": False,
            "message": f"合并过程出错: {str(e)}",
            "file_path": "",
            "download_url": ""
        }

@app.post("/api/list-reports")
def list_reports(req: Optional[dict] = None):
    """列出生成的报告文件，供选择合并"""
    # req 预留用于分页或过滤
    try:
        # 扫描 OUTPUT_DIR (及其第一级子文件夹?)
        # 假设报告都存在于 output/report/下面，可能按公司名分了文件夹
        # 我们深度遍历一下，但不要太深
        
        report_files = []
        for root, dirs, files in os.walk(OUTPUT_DIR):
            for file in files:
                if file.endswith('.docx') and not file.startswith('~$'):
                    full_path = os.path.join(root, file)
                    stat = os.stat(full_path)
                    report_files.append({
                        "path": full_path,
                        "name": file,
                        "mtime": stat.st_mtime,
                        "date": datetime.fromtimestamp(stat.st_mtime).strftime('%Y-%m-%d %H:%M:%S'),
                        "folder": os.path.basename(root)
                    })
        
        # 按修改时间倒序
        report_files.sort(key=lambda x: x['mtime'], reverse=True)
        return report_files
    except Exception as e:
        return []

@app.post("/api/delete-report")
def delete_report(req: DeleteFileRequest):
    """删除指定的报告文件"""
    try:
        file_path = req.path
        # 安全检查：确保文件在 output 目录下
        abs_path = os.path.abspath(file_path)
        output_abs = os.path.abspath(OUTPUT_DIR)
        
        if not abs_path.startswith(output_abs):
             return {"success": False, "message": "无法删除该目录下的文件 (Permission Denied)"}

        if os.path.exists(abs_path) and os.path.isfile(abs_path):
            os.remove(abs_path)
            return {"success": True, "message": "文件已删除"}
        else:
            return {"success": False, "message": "文件不存在或已被删除"}
    except Exception as e:
        return {"success": False, "message": f"删除失败: {str(e)}"}

@app.get("/api/icp-columns")
def get_icp_columns():
    """获取 ICP 表的所有字段名"""
    return get_db_reader().get_table_columns("icp_info_Sheet1")

@app.get("/api/icp-list")
def get_icp_list():
    """获取所有 ICP 备案信息"""
    try:
        reload_icp_cache()
        icp_infos = get_cached_icp_infos()
        if not icp_infos:
            return []
        
        # 将字典的值转换为列表返回
        return list(icp_infos.values())
    except Exception as e:
        logger.error(f"Error fetching ICP list: {e}")
        return []

@app.post("/api/icp-entry")
def add_icp_entry(entry: IcpEntryRequest):
    """添加 ICP 备案信息"""
    try:
        success, msg = get_db_reader().add_icp_entry(entry.dict())
        if not success:
            raise HTTPException(status_code=400, detail=msg)
        
        reload_icp_cache()
        return {"success": True, "message": msg}
    except Exception as e:
        logger.error(f"Add ICP entry failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.put("/api/icp-entry/{entry_id}")
def update_icp_entry(entry_id: str, entry: IcpEntryRequest):
    """更新 ICP 备案信息"""
    try:
        success, msg = get_db_reader().update_icp_entry(entry_id, entry.dict())
        if not success:
            raise HTTPException(status_code=400, detail=msg)
        
        reload_icp_cache()
        return {"success": True, "message": msg}
    except Exception as e:
        logger.error(f"Update ICP entry failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/icp-entry/{entry_id}")
def delete_icp_entry(entry_id: str):
    """删除单个 ICP 备案信息"""
    try:
        # 复用批量删除逻辑
        success, msg = get_db_reader().batch_delete_icp([entry_id])
        if not success:
            raise HTTPException(status_code=400, detail=msg)
        
        reload_icp_cache()
        return {"success": True, "message": msg}
    except Exception as e:
        logger.error(f"Delete ICP entry failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/icp-batch-delete")
def batch_delete_icp(req: BatchDeleteRequest):
    """批量删除 ICP 备案信息"""
    try:
        success, msg = get_db_reader().batch_delete_icp(req.ids)
        if not success:
            raise HTTPException(status_code=400, detail=msg)
        
        reload_icp_cache()
        return {"success": True, "message": msg}
    except Exception as e:
        logger.error(f"Batch delete ICP failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
@app.get("/api/templates")
def get_templates(include_details: bool = False):
    """
    获取所有可用模板列表
    
    Args:
        include_details: 是否包含详细信息（文件大小、字段数等）
    """
    if include_details:
        # 返回详细信息
        templates = [
            get_template_manager().get_template_details(t["id"]) 
            for t in get_template_manager().get_template_list()
        ]
        # 过滤掉 None 值（模板不存在的情况）
        templates = [t for t in templates if t is not None]
    else:
        # 返回简要信息
        templates = get_template_manager().get_template_list()
    
    return {
        "templates": templates,
        "default_template": get_template_manager().default_template_id
    }

@app.get("/api/templates/{template_id}/schema")
def get_template_schema(template_id: str):
    """获取指定模板的完整 schema"""
    schema = get_template_manager().get_template_schema(template_id)
    if not schema:
        raise HTTPException(status_code=404, detail=f"Template not found: {template_id}")
    return schema

@app.get("/api/templates/{template_id}/versions")
def get_template_versions(template_id: str):
    """获取模板的所有版本"""
    versions = get_template_manager().get_template_versions(template_id)
    return {"template_id": template_id, "versions": versions}

@app.get("/api/templates/{template_id}/data-sources")
def get_template_data_sources(template_id: str):
    """获取模板所需的数据源数据"""
    # 准备数据库数据
    vuln_list, _ = get_cached_vulnerabilities()
    db_data = {
        "vulnerabilities": vuln_list,
        "icp_cache": list(get_cached_icp_infos().values())
    }
    
    resolved = get_template_manager().resolve_data_sources(template_id, db_data)
    if not resolved:
        raise HTTPException(status_code=404, detail=f"Template not found: {template_id}")
    
    return resolved

@app.post("/api/templates/{template_id}/validate")
def validate_template_data(template_id: str, data: Dict[str, Any]):
    """验证表单数据"""
    is_valid, errors = get_template_manager().validate_report_data(template_id, data)
    return {
        "valid": is_valid,
        "errors": errors
    }

@app.post("/api/templates/{template_id}/generate")
def generate_template_report(template_id: str, data: Dict[str, Any]):
    """
    使用指定模板生成报告 (新接口，使用 Handler)
    """
    try:
        # 获取模板处理器
        handler = HandlerRegistry.get_handler(template_id, get_template_manager(), config)
        
        if not handler:
            return {
                "success": False,
                "report_path": "",
                "download_url": "",
                "message": f"No handler registered for template: {template_id}",
                "errors": []
            }
        
        # 执行报告生成
        result = handler.run(data, OUTPUT_DIR)
        
        if result["success"]:
            # 生成下载 URL
            file_name = os.path.basename(result["report_path"])
            unit_name = data.get("unit_name", "Unknown")
            download_url = f"/reports/{unit_name}/{file_name}"
            
            return {
                "success": True,
                "report_path": result["report_path"],
                "download_url": download_url,
                "message": result["message"]
            }
        else:
            return {
                "success": False,
                "report_path": "",
                "download_url": "",
                "message": result.get("message", "报告生成失败"),
                "errors": result.get("errors", [])
            }
    except Exception as e:
        logger.error(f"Generate report error: {traceback.format_exc()}")
        return {
            "success": False,
            "report_path": "",
            "download_url": "",
            "message": f"报告生成异常: {str(e)}",
            "errors": []
        }

@app.get("/api/templates/{template_id}/preview")
def get_template_preview_config(template_id: str):
    """获取模板预览配置"""
    schema = get_template_manager().get_template_schema(template_id)
    if not schema:
        raise HTTPException(status_code=404, detail=f"Template not found: {template_id}")
    
    return {
        "template_id": template_id,
        "name": schema.get("name", ""),
        "preview": schema.get("preview", {})
    }

@app.post("/api/templates/reload")
def reload_templates():
    """
    重新加载所有模板（支持热加载）
    
    注意：
    - 模板的 Handler 和 Schema 可以热加载
    - 新增的 API 路由需要重启应用才能生效（FastAPI 限制）
    """
    try:
        # 记录重载前的 handler 数量
        handlers_before = set(HandlerRegistry.list_registered())
        
        # 重新加载模板
        get_template_manager().reload_templates()
        templates = get_template_manager().get_template_list()
        handlers_after = set(HandlerRegistry.list_registered())
        
        # 检测是否有新增的 handler（问题 8：路由无法动态卸载的限制提示）
        new_handlers = handlers_after - handlers_before
        warning_message = None
        requires_restart = False
        
        # 检查新增的 handler 是否包含路由
        routers = get_template_manager().get_template_routers()
        new_routes = [h for h in new_handlers if h in routers]
        
        if new_routes:
            warning_message = f"检测到新增带路由的模板 ({', '.join(new_routes)})，需要重启应用才能生效"
            requires_restart = True
        elif new_handlers:
            # 即使没有路由，也提示一下，但不是强制重启
            pass
        
        return {
            "success": True,
            "message": "模板已重新加载",
            "warning": warning_message,
            "loaded_count": len(templates),
            "templates": templates,
            "handlers": list(handlers_after),
            "new_handlers": list(new_handlers),
            "requires_restart": requires_restart
        }
    except Exception as e:
        logger.error(f"Failed to reload templates: {str(e)}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to reload templates: {str(e)}")


@app.get("/api/templates/{template_id}/details")
def get_template_details(template_id: str):
    """获取模板详细信息"""
    details = get_template_manager().get_template_details(template_id)
    if not details:
        raise HTTPException(status_code=404, detail=f"Template not found: {template_id}")
    return details


@app.get("/api/templates/{template_id}/check-deps")
def check_template_dependencies(template_id: str):
    """
    检查模板依赖（解决问题 9：模板依赖管理缺失）
    
    Args:
        template_id: 模板ID
        
    Returns:
        {
            "template_id": str,
            "dependencies_satisfied": bool,
            "missing_dependencies": List[str],
            "message": str
        }
    """
    tm = get_template_manager()
    satisfied, missing = tm.check_dependencies(template_id)
    
    return {
        "template_id": template_id,
        "dependencies_satisfied": satisfied,
        "missing_dependencies": missing,
        "message": "所有依赖已满足" if satisfied else f"缺少依赖: {', '.join(missing)}"
    }


@app.get("/api/templates/{template_id}/export")
def export_template(template_id: str):
    """导出模板为压缩包"""
    template_dir = os.path.join(TEMPLATES_DIR, template_id)
    if not os.path.exists(template_dir):
        raise HTTPException(status_code=404, detail=f"Template not found: {template_id}")
    
    # 创建内存中的 ZIP 文件
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, files in os.walk(template_dir):
            # 排除 __pycache__ 等目录
            dirs[:] = [d for d in dirs if not d.startswith('__')]
            
            for file in files:
                if file.endswith('.pyc'):
                    continue
                file_path = os.path.join(root, file)
                arcname = os.path.relpath(file_path, template_dir)
                zf.write(file_path, f"{template_id}/{arcname}")
    
    zip_buffer.seek(0)
    
    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename={template_id}_template.zip"}
    )


@app.post("/api/templates/batch-export")
def batch_export_templates(template_ids: List[str]):
    """批量导出多个模板为一个压缩包"""
    if not template_ids:
        raise HTTPException(status_code=400, detail="No template IDs provided")
    
    # 创建内存中的 ZIP 文件
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
        for template_id in template_ids:
            template_dir = os.path.join(TEMPLATES_DIR, template_id)
            if not os.path.exists(template_dir):
                logger.warning(f"Template not found: {template_id}")
                continue
            
            # 将每个模板添加到 ZIP 中
            for root, dirs, files in os.walk(template_dir):
                # 排除 __pycache__ 等目录
                dirs[:] = [d for d in dirs if not d.startswith('__')]
                
                for file in files:
                    if file.endswith('.pyc'):
                        continue
                    file_path = os.path.join(root, file)
                    arcname = os.path.relpath(file_path, TEMPLATES_DIR)
                    zf.write(file_path, arcname)
    
    zip_buffer.seek(0)
    
    # 生成文件名（带时间戳）
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    filename = f"templates_batch_{timestamp}.zip"
    
    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


def _detect_templates_in_zip(names: List[str]) -> List[str]:
    """
    检测 ZIP 中的模板结构
    返回模板 ID 列表
    """
    template_ids = set()
    
    for name in names:
        parts = name.split('/')
        if len(parts) >= 2 and parts[1] == 'schema.yaml':
            # 找到 template_id/schema.yaml
            template_ids.add(parts[0])
    
    return sorted(list(template_ids))


def _import_single_template(zf, template_id: str, all_names: List[str], overwrite: bool) -> Dict[str, Any]:
    """
    从 ZIP 中导入单个模板 (Security Hardened)
    """
    # 过滤出属于该模板的文件
    template_files = [n for n in all_names if n.startswith(f"{template_id}/")]
    
    if not template_files:
        return {"success": False, "reason": "No files found"}
    
    # 检查必需文件
    schema_found = any(n == f"{template_id}/schema.yaml" for n in template_files)
    if not schema_found:
        return {"success": False, "reason": "schema.yaml not found"}
    
    # 检查是否已存在
    target_dir = os.path.join(TEMPLATES_DIR, template_id)
    if os.path.exists(target_dir):
        if not overwrite:
            return {"success": False, "reason": "Already exists (overwrite=false)"}
        # 备份现有模板
        backup_dir = f"{target_dir}_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        shutil.move(target_dir, backup_dir)
    
    # [Security Fix] Zip Slip 防御 & 安全解压
    extracted_files = []
    try:
        for file_name in template_files:
            # 1. 检查文件名是否包含路径遍历字符
            if '..' in file_name or file_name.startswith('/') or '\\' in file_name:
                raise ValueError(f"Malicious path detected: {file_name}")
            
            # 2. 规范化目标路径
            target_path = os.path.join(TEMPLATES_DIR, file_name)
            if not os.path.abspath(target_path).startswith(os.path.abspath(TEMPLATES_DIR)):
                raise ValueError(f"Path traversal attempt: {file_name}")

            # 3. 解压
            zf.extract(file_name, TEMPLATES_DIR)
            extracted_files.append(target_path)
            
            # 4. [Security Fix] 如果是 .py 文件，立即进行静态审计
            # 如果解压了恶意代码，虽然还未加载，但留在磁盘上是隐患。
            # 这里我们利用 TemplateManager 的审计功能进行 Pre-validation
            if file_name.endswith('.py'):
                try:
                    # 临时实例化一个 TemplateManager 来借用其审计方法，或者直接调用静态方法
                    # 这里直接调用实例的方法（因为 startup 时已初始化单例）
                    tm = get_template_manager()
                    tm.audit_code_security(template_id, target_path)
                except Exception as audit_err:
                    # 审计失败，回滚操作（删除已解压的文件）
                    logger.error(f"Audit failed during import for {file_name}: {audit_err}")
                    raise ValueError(f"Security Policy Violation: {str(audit_err)}")

    except Exception as e:
        # 发生错误，清理残局
        if os.path.exists(target_dir):
            shutil.rmtree(target_dir)
        return {"success": False, "reason": str(e)}
    
    return {"success": True}


@app.post("/api/templates/import")
async def import_template(file: UploadFile = File(...), overwrite: bool = Form(default=False)):
    """
    导入模板压缩包
    支持三种格式：
    1. 单个模板 ZIP（template_id/schema.yaml）
    2. 多模板综合 ZIP（template1/..., template2/...）
    3. 通过多次调用导入多个文件
    """
    if not file.filename or not file.filename.endswith('.zip'):
        raise HTTPException(status_code=400, detail="Only ZIP files are supported")
    
    try:
        content = await file.read()
        zip_buffer = io.BytesIO(content)
        
        with zipfile.ZipFile(zip_buffer, 'r') as zf:
            names = zf.namelist()
            if not names:
                raise HTTPException(status_code=400, detail="Empty ZIP file")
            
            # 检测 ZIP 结构：单模板 or 多模板
            template_ids = _detect_templates_in_zip(names)
            
            if not template_ids:
                raise HTTPException(status_code=400, detail="No valid templates found in ZIP")
            
            imported = []
            skipped = []
            errors = []
            
            for template_id in template_ids:
                try:
                    result = _import_single_template(zf, template_id, names, overwrite)
                    if result['success']:
                        imported.append(template_id)
                    else:
                        skipped.append({'id': template_id, 'reason': result['reason']})
                except Exception as e:
                    errors.append({'id': template_id, 'error': str(e)})
            
            # 重新加载模板
            if imported:
                get_template_manager().reload_templates()
            
            return {
                "success": len(imported) > 0,
                "imported": imported,
                "skipped": skipped,
                "errors": errors,
                "message": f"Successfully imported {len(imported)} template(s)"
            }
            
    except zipfile.BadZipFile:
        raise HTTPException(status_code=400, detail="Invalid ZIP file")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Import failed: {str(e)}")


@app.post("/api/templates/batch-import")
async def batch_import_templates(files: List[UploadFile] = File(...), overwrite: bool = Form(default=False)):
    """
    批量导入多个模板文件
    支持选择多个 ZIP 文件同时上传
    """
    if not files:
        raise HTTPException(status_code=400, detail="No files provided")
    
    results = []
    
    for file in files:
        try:
            # 调用单文件导入逻辑
            result = await import_template(file, overwrite)
            results.append({
                "filename": file.filename,
                "success": result["success"],
                "imported": result.get("imported", []),
                "message": result.get("message", "")
            })
        except HTTPException as e:
            results.append({
                "filename": file.filename,
                "success": False,
                "error": e.detail
            })
        except Exception as e:
            results.append({
                "filename": file.filename,
                "success": False,
                "error": str(e)
            })
    
    total_imported = sum(len(r.get("imported", [])) for r in results if r["success"])
    
    return {
        "success": total_imported > 0,
        "total_files": len(files),
        "total_imported": total_imported,
        "results": results
    }


@app.delete("/api/templates/{template_id}")
def delete_template(template_id: str, backup: bool = True):
    """删除模板"""
    # 保护默认模板不被删除
    protected_templates = ['vuln_report']
    if template_id in protected_templates:
        raise HTTPException(status_code=403, detail=f"Cannot delete protected template: {template_id}")
    
    template_dir = os.path.join(TEMPLATES_DIR, template_id)
    if not os.path.exists(template_dir):
        raise HTTPException(status_code=404, detail=f"Template not found: {template_id}")
    
    try:
        if backup:
            # 确保 deleted 目录存在
            os.makedirs(TEMPLATES_DELETED_DIR, exist_ok=True)
            # 移动到 deleted 目录
            deleted_path = os.path.join(TEMPLATES_DELETED_DIR, template_id)
            # 如果已存在同名已删除模板，添加时间戳
            if os.path.exists(deleted_path):
                deleted_path = os.path.join(TEMPLATES_DELETED_DIR, f"{template_id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}")
            shutil.move(template_dir, deleted_path)
        else:
            shutil.rmtree(template_dir)
        
        # 重新加载模板
        get_template_manager().reload_templates()
        
        return {
            "success": True,
            "message": f"Template '{template_id}' deleted successfully",
            "backed_up": backup
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Delete failed: {str(e)}")


if __name__ == "__main__":
    import multiprocessing
    multiprocessing.freeze_support()
    # 从共享配置读取服务器设置
    server_host = shared_config.get("server", {}).get("host", "127.0.0.1")
    server_port = shared_config.get("server", {}).get("port", 8000)
    # workers=1 确保单进程运行，避免 Windows 上产生多个进程
    # reload=False 禁用热重载（打包后不需要）
    uvicorn.run(app, host=server_host, port=server_port, workers=1, reload=False)

