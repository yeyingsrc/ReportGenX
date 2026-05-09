# Bump Version Skill

Update the project version across all files and push to remote.

## Version Files (4 locations)

| File | Pattern | Example |
|------|---------|---------|
| `package.json` | `"version": "X.Y.Z"` | `"version": "0.18.5"` |
| `backend/shared-config.json` | `"version": "X.Y.Z"` | `"version": "0.18.5"` |
| `README.md` | `当前归档版本：\`X.Y.Z\`` | `当前归档版本：\`0.18.5\`` |
| `backend/config.yaml` | `version: VX.Y.Z` | `version: V0.18.5` |

## Workflow

1. **Read current version** from `package.json` (line 3, `"version"` field)
2. **Determine new version**:
   - If user specifies a version (e.g. "0.19.0"), use that
   - If user says "patch" / "minor" / "major", auto-increment:
     - `patch`: 0.18.5 → 0.18.6
     - `minor`: 0.18.5 → 0.19.0
     - `major`: 0.18.5 → 1.0.0
   - If no version specified, ask the user
3. **Update all 4 files** in parallel using the Edit tool:
   - `package.json`: replace `"version": "OLD"` with `"version": "NEW"`
   - `backend/shared-config.json`: replace `"version": "OLD"` with `"version": "NEW"`
   - `README.md`: replace `` `OLD` `` with `` `NEW` `` in the line containing `当前归档版本`
   - `backend/config.yaml`: replace `version: VOLD` with `version: VNEW`
4. **Commit**: `git add` all 4 files, commit with message `chore: bump project version to NEW`
5. **Push**: `git push`
6. **Confirm**: output the commit hash and new version

## Example

```
User: bump version to 0.19.0
→ Reads current 0.18.5, updates 4 files, commits, pushes
→ Output: "Bumped to 0.19.0 (abc1234)"
```
