"""生成六个AI模型LOGO卡片PNG。

设计原则：每个LOGO采用模型官方主色，圆形底色+模型中文名+英文名+简单图形标识。
"""
from PIL import Image, ImageDraw, ImageFont
import os

OUTPUT_DIR = r"D:\Claude Code Files\Project_Patent search system_v1\ppt-assets\logos"
os.makedirs(OUTPUT_DIR, exist_ok=True)

# Windows 中文字体路径
FONT_PATH = r"C:\Windows\Fonts\msyh.ttc"

# 模型官方主色 (来源：各家品牌色)
MODELS = [
    {
        "name_zh": "Kimi",
        "name_en": "Moonshot AI",
        "color": "#1A1A1A",     # Kimi 黑色
        "accent": "#FF6B35",    # 橙色点缀
        "subtitle": "K2.6",
        "shape": "moon",
    },
    {
        "name_zh": "智谱",
        "name_en": "Zhipu GLM",
        "color": "#3859FF",     # 智谱蓝
        "accent": "#FFFFFF",
        "subtitle": "GLM-5.1",
        "shape": "tri",
    },
    {
        "name_zh": "通义千问",
        "name_en": "Alibaba Qwen",
        "color": "#615CED",     # 千问紫
        "accent": "#FFFFFF",
        "subtitle": "Qwen",
        "shape": "wave",
    },
    {
        "name_zh": "DeepSeek",
        "name_en": "深度求索",
        "color": "#4D6BFE",     # DeepSeek 蓝
        "accent": "#FFFFFF",
        "subtitle": "DeepSeek",
        "shape": "deep",
    },
    {
        "name_zh": "秘塔",
        "name_en": "Metaso AI",
        "color": "#FF4757",     # 秘塔红
        "accent": "#FFFFFF",
        "subtitle": "秘塔 AI",
        "shape": "search",
    },
    {
        "name_zh": "OpenAI",
        "name_en": "兼容接口",
        "color": "#10A37F",     # OpenAI 绿
        "accent": "#FFFFFF",
        "subtitle": "Compatible",
        "shape": "knot",
    },
]


def hex_to_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))


def get_font(size, bold=False):
    return ImageFont.truetype(FONT_PATH, size)


def draw_shape(draw, shape, cx, cy, size, color):
    """根据shape名称在中心点绘制标识图形。"""
    if shape == "moon":
        # 月牙
        draw.ellipse([cx-size, cy-size, cx+size, cy+size], fill=color)
        draw.ellipse([cx-size//2, cy-size, cx+size, cy+size], fill=(255,255,255,0))
    elif shape == "tri":
        # 三角形 (智谱)
        draw.polygon([(cx, cy-size), (cx-size, cy+size//2), (cx+size, cy+size//2)], fill=color)
    elif shape == "wave":
        # 波形 (千问)
        for i in range(3):
            offset = (i - 1) * size // 2
            draw.arc([cx-size+offset, cy-size//2, cx+size+offset, cy+size//2], 0, 180, fill=color, width=4)
    elif shape == "deep":
        # 圆环 (DeepSeek)
        draw.ellipse([cx-size, cy-size, cx+size, cy+size], outline=color, width=5)
        draw.ellipse([cx-size//2, cy-size//2, cx+size//2, cy+size//2], fill=color)
    elif shape == "search":
        # 放大镜 (秘塔)
        draw.ellipse([cx-size, cy-size, cx+size//2, cy+size//2], outline=color, width=4)
        draw.line([(cx+size//4, cy+size//4), (cx+size, cy+size)], fill=color, width=5)
    elif shape == "knot":
        # 花结 (OpenAI风格六瓣)
        import math
        for i in range(6):
            ang = math.radians(60 * i)
            x = cx + int(size * 0.7 * math.cos(ang))
            y = cy + int(size * 0.7 * math.sin(ang))
            draw.ellipse([x-size//4, y-size//4, x+size//4, y+size//4], fill=color)


def make_logo_card(model, size=(360, 200)):
    img = Image.new("RGBA", size, (255, 255, 255, 255))
    draw = ImageDraw.Draw(img)

    color = hex_to_rgb(model["color"])
    accent = hex_to_rgb(model["accent"])

    # 左侧色块
    draw.rectangle([0, 0, 140, size[1]], fill=color)

    # 图形标识
    draw_shape(draw, model["shape"], 70, 80, 38, accent)

    # 右侧：中文名（粗体）+ 英文名 + 副标题
    font_zh = get_font(36)
    font_en = get_font(18)
    font_sub = get_font(20)

    draw.text((160, 35), model["name_zh"], fill=(20, 20, 20), font=font_zh)
    draw.text((160, 90), model["name_en"], fill=(120, 120, 120), font=font_en)

    # 副标题带边框
    bbox = draw.textbbox((0, 0), model["subtitle"], font=font_sub)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    pad = 8
    box_x, box_y = 160, 130
    draw.rounded_rectangle(
        [box_x, box_y, box_x + tw + pad * 2, box_y + th + pad * 2],
        radius=4,
        fill=color,
    )
    draw.text((box_x + pad, box_y + pad), model["subtitle"], fill=accent, font=font_sub)

    out_path = os.path.join(OUTPUT_DIR, f"{model['name_zh']}.png")
    img.convert("RGB").save(out_path, "PNG")
    print(f"Saved: {out_path}")


for m in MODELS:
    make_logo_card(m)

print(f"\nAll logos saved to: {OUTPUT_DIR}")