import zipfile, json
z=zipfile.ZipFile(r"D:/GrokbotWork/FreeFilmCut/freefilmcut/apps/web/public/vfxpacks/text-templates/freecapcut.hello.vfxpack")
man=json.loads(z.read("pack/manifest.json"))
print("id", man.get("id"), "type", man.get("type"), "displayName", man.get("displayName"))
print("textTemplate in manifest", "textTemplate" in man)
tt=json.loads(z.read("pack/text-template.json"))
print("tt format", tt.get("format"), "name", tt.get("name"))
# list how builtin packs are registered