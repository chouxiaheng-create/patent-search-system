"""将报告样例渲染为高分辨率图片, 用于嵌入PPT."""
from PIL import Image, ImageDraw, ImageFont
import os

OUTPUT_DIR = r"D:\Claude Code Files\Project_Patent search system_v1\ppt-assets\report_pages"
os.makedirs(OUTPUT_DIR, exist_ok=True)

FONT_PATH = r"C:\Windows\Fonts\msyh.ttc"
REPORT_PATH = r"D:\Claude Code Files\Project_Patent search system_v1\检索报告\patent-report.md"


def read_report():
    with open(REPORT_PATH, "r", encoding="utf-8") as f:
        return f.read()


def wrap_text(text, font, max_width, draw):
    """按像素宽度自动换行."""
    lines = []
    for paragraph in text.split("\n"):
        if not paragraph.strip():
            lines.append("")
            continue
        current = ""
        for ch in paragraph:
            test = current + ch
            bbox = draw.textbbox((0, 0), test, font=font)
            if bbox[2] - bbox[0] > max_width:
                lines.append(current)
                current = ch
            else:
                current = test
        if current:
            lines.append(current)
    return lines


def render_page(content, title, out_path, page_w=1200, page_h=1500):
    """渲染一页报告: 白底+标题+正文."""
    img = Image.new("RGB", (page_w, page_h), (255, 255, 255))
    draw = ImageDraw.Draw(img)

    font_title = ImageFont.truetype(FONT_PATH, 36)
    font_h2 = ImageFont.truetype(FONT_PATH, 28)
    font_h3 = ImageFont.truetype(FONT_PATH, 24)
    font_body = ImageFont.truetype(FONT_PATH, 18)
    font_meta = ImageFont.truetype(FONT_PATH, 20)

    # 页眉蓝色条
    draw.rectangle([0, 0, page_w, 60], fill=(56, 89, 255))
    draw.text((30, 12), "专利检索智能体 — 报告样例", fill=(255, 255, 255), font=font_title)

    # 页面标题
    draw.text((30, 80), title, fill=(20, 20, 20), font=font_h2)
    draw.line([(30, 130), (page_w - 30, 130)], fill=(220, 220, 220), width=2)

    y = 150
    margin = 30
    max_width = page_w - 2 * margin

    for line in content.split("\n"):
        line_stripped = line.rstrip()
        if not line_stripped:
            y += 12
            continue
        if line_stripped.startswith("# "):
            continue  # 主标题已渲染
        if line_stripped.startswith("## "):
            y += 16
            heading_text = line_stripped[3:]
            draw.text((margin, y), heading_text, fill=(56, 89, 255), font=font_h2)
            y += 50
        elif line_stripped.startswith("### "):
            y += 12
            heading_text = line_stripped[4:]
            draw.text((margin, y), heading_text, fill=(20, 20, 80), font=font_h3)
            y += 40
        elif line_stripped.startswith("- **"):
            # 元数据行
            # 提取 **key**: value
            try:
                key_end = line_stripped.index("**", 4)
                key = line_stripped[4:key_end]
                value = line_stripped[key_end + 3:].lstrip(": ").rstrip()
                draw.text((margin + 20, y), f"● {key}:", fill=(80, 80, 80), font=font_meta)
                bbox = draw.textbbox((0, 0), f"● {key}:", font=font_meta)
                kv_width = bbox[2] - bbox[0]
                wrapped = wrap_text(value, font_body, max_width - kv_width - 30, draw)
                for i, wl in enumerate(wrapped):
                    draw.text((margin + 20 + kv_width, y + i * 26), wl, fill=(40, 40, 40), font=font_body)
                y += max(30, 26 * len(wrapped) + 8)
            except ValueError:
                wrapped = wrap_text(line_stripped, font_body, max_width - 30, draw)
                for wl in wrapped:
                    draw.text((margin + 20, y), wl, fill=(40, 40, 40), font=font_body)
                    y += 26
        else:
            wrapped = wrap_text(line_stripped, font_body, max_width - 30, draw)
            for wl in wrapped:
                draw.text((margin + 20, y), wl, fill=(40, 40, 40), font=font_body)
                y += 26
        y += 4
        if y > page_h - 50:
            break

    img.save(out_path, "PNG", optimize=True)
    print(f"Saved: {out_path}")


def main():
    content = read_report()
    # 第一页: 头部 + 第1-3篇
    # 第二页: 第4-7篇
    # 第三页: 第8-10篇
    sections = content.split("---")
    header = sections[0] if sections else ""
    body = sections[-1] if len(sections) > 1 else ""

    # 分割 body 为多个组 (按 ### N.)
    import re
    parts = re.split(r"(### \d+\..*?)(?=\n### |\Z)", body, flags=re.DOTALL)
    # parts: [pre, heading1, content1, heading2, content2, ...]
    documents = []
    for i in range(1, len(parts), 2):
        heading = parts[i]
        doc = parts[i+1] if i+1 < len(parts) else ""
        documents.append(heading + doc)

    # Page 1: header + 3 docs
    page1_content = header + "\n---\n\n## 最相关对比文献\n\n" + "\n\n".join(documents[:3])
    render_page(page1_content, "前 3 篇对比文献", os.path.join(OUTPUT_DIR, "report_p1.png"))

    # Page 2: docs 4-7
    page2_content = "## 最相关对比文献\n\n" + "\n\n".join(documents[3:7])
    render_page(page2_content, "第 4-7 篇对比文献", os.path.join(OUTPUT_DIR, "report_p2.png"))

    # Page 3: docs 8-10
    page3_content = "## 最相关对比文献\n\n" + "\n\n".join(documents[7:10])
    render_page(page3_content, "第 8-10 篇对比文献", os.path.join(OUTPUT_DIR, "report_p3.png"))

    print("\n报告页面图片已生成。")


if __name__ == "__main__":
    main()