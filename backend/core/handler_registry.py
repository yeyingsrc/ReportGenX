"""处理器注册表：从 base_handler 抽离，避免循环导入。"""

from typing import Any, Dict, List, Optional, Type

from .logger import setup_logger

logger = setup_logger("HandlerRegistry")


class HandlerRegistry:
    """用于注册和获取不同模板处理器。"""

    _handlers: Dict[str, Type[Any]] = {}

    @classmethod
    def register(cls, template_id: str, handler_class: Type[Any]) -> None:
        """注册模板处理器。"""
        if not isinstance(handler_class, type):
            raise TypeError(f"{handler_class} must be a class")

        if template_id in cls._handlers:
            logger.warning(f"Overwriting existing handler: {template_id}")

        cls._handlers[template_id] = handler_class

    @classmethod
    def get_handler(
        cls,
        template_id: str,
        template_manager: Any,
        config: Optional[Dict[str, Any]] = None,
    ) -> Optional[Any]:
        """获取处理器实例。"""
        handler_class = cls._handlers.get(template_id)
        if not handler_class:
            return None

        return handler_class(template_manager, template_id, config)

    @classmethod
    def has_handler(cls, template_id: str) -> bool:
        """检查是否已注册模板处理器。"""
        return template_id in cls._handlers

    @classmethod
    def list_registered(cls) -> List[str]:
        """列出所有已注册模板 ID。"""
        return list(cls._handlers.keys())

    @classmethod
    def clear(cls) -> None:
        """清空所有已注册处理器。"""
        cls._handlers.clear()


def register_handler(template_id: str):
    """装饰器：注册模板处理器。"""

    def decorator(handler_class: Type[Any]):
        HandlerRegistry.register(template_id, handler_class)
        return handler_class

    return decorator
