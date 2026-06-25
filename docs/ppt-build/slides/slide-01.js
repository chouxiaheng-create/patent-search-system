// Patent Search Agent System Architecture Diagram - Slide 01
// 4 layers + right-side core data flow card
// Editable PPT, fonts: Microsoft YaHei for Chinese, Arial for English

function createSlide(pres, theme) {
  const slide = pres.addSlide();
  slide.background = { color: theme.bg };

  // ============================================================
  // TITLE BAR (y: 0 -> 0.5)
  // ============================================================
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: 10, h: 0.5,
    fill: { color: theme.white }, line: { type: 'none' }
  });
  slide.addShape(pres.shapes.LINE, {
    x: 0, y: 0.5, w: 10, h: 0,
    line: { color: theme.primary, width: 1.5 }
  });
  slide.addText('\u4e13\u5229\u68c0\u7d22\u667a\u80fd\u4f53\u7cfb\u7edf\u67b6\u6784\u56fe', {
    x: 0.3, y: 0.05, w: 4.8, h: 0.4,
    fontSize: 18, fontFace: 'Microsoft YaHei', bold: true,
    color: theme.primary, valign: 'middle', margin: 0
  });

  // Legend (right side of title bar)
  const legends = [
    { type: 'rect',   color: theme.blue_mid,   fill: theme.blue_light,   label: '\u4e1a\u52a1\u6a21\u5757' },
    { type: 'arrow',  color: theme.orange_mid, fill: null,               label: '\u5173\u952e\u6570\u636e\u6d41' },
    { type: 'rect',   color: theme.green_mid,  fill: theme.green_light,  label: '\u5b58\u50a8\u670d\u52a1' },
    { type: 'rect_d', color: theme.gray_sub,   fill: theme.white,        label: '\u5916\u90e8\u4f9d\u8d56' },
    { type: 'dash',   color: theme.blue_mid,   fill: null,               label: '\u5b9e\u65f6\u8ba2\u9605' },
    { type: 'line',   color: theme.gray_line,  fill: null,               label: '\u8f85\u52a9\u8fde\u7ebf' }
  ];
  let lx = 5.05;
  for (const lg of legends) {
    const cx = lx, cy = 0.16;
    if (lg.type === 'rect' || lg.type === 'rect_d') {
      slide.addShape(pres.shapes.RECTANGLE, {
        x: cx, y: cy, w: 0.14, h: 0.14,
        fill: { color: lg.fill },
        line: { color: lg.color, width: 1 },
        rectRadius: 0.02
      });
    } else if (lg.type === 'arrow') {
      slide.addShape(pres.shapes.LINE, {
        x: cx, y: cy + 0.07, w: 0.1, h: 0,
        line: { color: lg.color, width: 2.5 }
      });
      slide.addShape(pres.shapes.RIGHT_TRIANGLE, {
        x: cx + 0.07, y: cy + 0.025, w: 0.06, h: 0.09,
        fill: { color: lg.color }, line: { type: 'none' },
        rotate: 90
      });
    } else if (lg.type === 'dash') {
      for (let i = 0; i < 3; i++) {
        slide.addShape(pres.shapes.LINE, {
          x: cx + i * 0.045, y: cy + 0.07, w: 0.035, h: 0,
          line: { color: lg.color, width: 1.5 }
        });
      }
    } else if (lg.type === 'line') {
      slide.addShape(pres.shapes.LINE, {
        x: cx, y: cy + 0.07, w: 0.14, h: 0,
        line: { color: lg.color, width: 1 }
      });
    }
    slide.addText(lg.label, {
      x: cx + 0.18, y: 0.1, w: 0.62, h: 0.3,
      fontSize: 8, fontFace: 'Microsoft YaHei',
      color: theme.secondary, valign: 'middle', margin: 0
    });
    lx += 0.8;
  }

  // ============================================================
  // LAYER 0: \u7528\u6237\u4e0e\u8868\u73b0\u5c42  (y: 0.7 -> 1.75)
  // ============================================================
  const L0_Y = 0.7, L0_H = 1.05;
  drawLayerHeader(slide, pres, theme,
    L0_Y,
    '\u7528\u6237\u4e0e\u8868\u73b0\u5c42 \u00b7 \u7528\u6237 + Next.js \u524d\u7aef',
    theme.primary);

  const L0_CARD_Y = L0_Y + 0.32;
  const L0_CARD_H = L0_H - 0.36;

  // ---- User card (orange) ----
  const userX = 0.3, userW = 1.55;
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: userX, y: L0_CARD_Y, w: userW, h: L0_CARD_H,
    fill: { color: theme.orange_light },
    line: { color: theme.orange_mid, width: 1.5 },
    rectRadius: 0.06,
    shadow: { type: 'outer', color: '000000', blur: 4, offset: 1, angle: 90, opacity: 0.1 }
  });
  const userCx = userX + userW / 2;
  // head (smaller, packed up top)
  slide.addShape(pres.shapes.OVAL, {
    x: userCx - 0.11, y: L0_CARD_Y + 0.04, w: 0.22, h: 0.22,
    fill: { color: theme.orange_mid },
    line: { color: theme.white, width: 1 }
  });
  slide.addShape(pres.shapes.OVAL, {
    x: userCx - 0.055, y: L0_CARD_Y + 0.025, w: 0.11, h: 0.13,
    fill: { color: theme.orange_light }, line: { type: 'none' }
  });
  // body (lower ellipse)
  slide.addShape(pres.shapes.OVAL, {
    x: userCx - 0.16, y: L0_CARD_Y + 0.24, w: 0.32, h: 0.18,
    fill: { color: theme.orange_mid }, line: { type: 'none' }
  });
  // "用户" label - tighter, inside box
  slide.addText('\u7528\u6237', {
    x: userX, y: L0_CARD_Y + 0.42, w: userW, h: 0.18,
    fontSize: 11, fontFace: 'Microsoft YaHei', bold: true,
    color: theme.orange_dark, align: 'center', valign: 'middle', margin: 0
  });
  // Sub-text - inside box bottom
  slide.addText('\u4e0a\u4f20\u4e13\u5229 \u00b7 \u914d\u7f6e\u68c0\u7d22 \u00b7 \u67e5\u770b\u62a5\u544a', {
    x: userX, y: L0_CARD_Y + 0.59, w: userW, h: 0.1,
    fontSize: 6, fontFace: 'Microsoft YaHei',
    color: theme.gray_sub, align: 'center', valign: 'middle', margin: 0
  });

  // ---- Step cards ----
  const steps = [
    { title: '\u6b65\u9aa4\u4e00 \u00b7 \u4e0a\u4f20', desc: '\u9009\u6a21\u578b/\u7b56\u7565\n\u4e0a\u4f20\u4e13\u5229\u6587\u4ef6',         fill: theme.blue_light,   stroke: theme.blue_mid },
    { title: '\u6b65\u9aa4\u4e8c \u00b7 \u914d\u7f6e', desc: '\u6a21\u578b x \u7b56\u7565\n\u62a5\u544a\u6a21\u578b\u9009\u62e9',         fill: theme.blue_light,   stroke: theme.blue_mid },
    { title: '\u6b65\u9aa4\u4e09 \u00b7 \u62a5\u544a', desc: '\u5b9e\u65f6\u8fdb\u5ea6\n\u62a5\u544a\u67e5\u770b\u4e0e\u5bfc\u51fa',         fill: theme.orange_light, stroke: theme.orange_mid }
  ];
  for (let i = 0; i < 3; i++) {
    const sx = 1.95 + i * 1.65;
    const s = steps[i];
    slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: sx, y: L0_CARD_Y, w: 1.55, h: L0_CARD_H,
      fill: { color: s.fill },
      line: { color: s.stroke, width: 1.5 },
      rectRadius: 0.06,
      shadow: { type: 'outer', color: '000000', blur: 4, offset: 1, angle: 90, opacity: 0.1 }
    });
    slide.addText(s.title, {
      x: sx, y: L0_CARD_Y + 0.04, w: 1.55, h: 0.26,
      fontSize: 11, fontFace: 'Microsoft YaHei', bold: true,
      color: theme.primary, align: 'center', valign: 'middle', margin: 0
    });
    slide.addShape(pres.shapes.LINE, {
      x: sx + 0.15, y: L0_CARD_Y + 0.32, w: 1.25, h: 0,
      line: { color: s.stroke, width: 0.5 }
    });
    slide.addText(s.desc, {
      x: sx + 0.08, y: L0_CARD_Y + 0.34, w: 1.39, h: L0_CARD_H - 0.36,
      fontSize: 9, fontFace: 'Microsoft YaHei',
      color: theme.secondary, align: 'center', valign: 'middle', margin: 0,
      paraSpaceAfter: 2
    });
  }

  // ============================================================
  // LAYER 1: \u5e94\u7528\u5c42 \u00b7 API \u8def\u7531  (y: 1.83 -> 2.35)
  // ============================================================
  const L1_Y = 1.83, L1_H = 0.52;
  drawLayerHeader(slide, pres, theme,
    L1_Y,
    '\u5e94\u7528\u5c42 \u00b7 API \u8def\u7531',
    theme.primary);

  const L1_CARD_Y = L1_Y + 0.32;
  const L1_CARD_H = L1_H - 0.36;

  const apis = [
    'POST \u6587\u6863', 'POST \u4efb\u52a1', '\u961f\u5217\u72b6\u6001',
    '\u5fc3\u8df3\u68c0\u6d4b', '\u6a21\u578b\u914d\u7f6e', '\u7b56\u7565\u914d\u7f6e', '\u62a5\u544a\u63a5\u53e3'
  ];
  const api_w = (6.7 - 6 * 0.06) / 7;
  for (let i = 0; i < apis.length; i++) {
    const ax = 0.3 + i * (api_w + 0.06);
    slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: ax, y: L1_CARD_Y, w: api_w, h: L1_CARD_H,
      fill: { color: theme.white },
      line: { color: theme.blue_mid, width: 1 },
      rectRadius: 0.04
    });
    slide.addText(apis[i], {
      x: ax, y: L1_CARD_Y, w: api_w, h: L1_CARD_H,
      fontSize: 9, fontFace: 'Microsoft YaHei',
      color: theme.primary, align: 'center', valign: 'middle', margin: 0
    });
  }

  // ============================================================
  // LAYER 2: \u961f\u5217\u4e0e AI \u5c42  (y: 2.43 -> 4.0)
  // ============================================================
  const L2_Y = 2.43, L2_H = 1.57;
  drawLayerHeader(slide, pres, theme,
    L2_Y,
    '\u961f\u5217\u4e0e AI \u5c42 \u00b7 Worker \u5904\u7406\u8fdb\u7a0b',
    theme.primary);

  const L2_CARD_Y = L2_Y + 0.32;
  const L2_CARD_H = L2_H - 0.36;

  const col_w = (6.7 - 2 * 0.15) / 3;
  const cols = [
    { x: 0.3,                      title: 'pg-boss \u4efb\u52a1\u961f\u5217', headerColor: theme.primary },
    { x: 0.3 + col_w + 0.15,       title: 'Worker \u5904\u7406\u6a21\u5757', headerColor: theme.primary },
    { x: 0.3 + 2 * (col_w + 0.15), title: 'AI \u9002\u914d\u5668\u5de5\u5382', headerColor: theme.primary }
  ];

  // Column 1: pg-boss
  drawL2ColumnHeader(slide, pres, theme, cols[0].x, L2_CARD_Y, col_w, cols[0].title);
  const pgboss = [
    { name: 'parse-job',  desc: '\u6587\u6863\u89e3\u6790\u4efb\u52a1' },
    { name: 'search-job', desc: '\u68c0\u7d22\u4efb\u52a1 (\u7b1b\u5361\u5c14\u79ef\u5c55\u5f00)' },
    { name: 'report \u4efb\u52a1', desc: '\u62a5\u544a\u751f\u6210\u4efb\u52a1' }
  ];
  drawL2Cards(slide, pres, theme, cols[0].x, L2_CARD_Y + 0.36, col_w, L2_CARD_H - 0.36,
    pgboss, theme.orange_light, theme.orange_mid, theme.orange_dark);

  // Column 2: Worker
  drawL2ColumnHeader(slide, pres, theme, cols[1].x, L2_CARD_Y, col_w, cols[1].title);
  const worker = [
    { name: '\u6587\u6863\u89e3\u6790\u5668', desc: 'PDF/DOCX/XLSX/TXT' },
    { name: '\u68c0\u7d22\u6267\u884c\u5668', desc: '\u6a21\u578b x \u7b56\u7565\u5faa\u73af \u00b7 \u53bb\u91cd' },
    { name: '\u62a5\u544a\u751f\u6210\u5668', desc: 'Top-N \u00b7 \u8def\u5f84\u6458\u8981 \u00b7 HTML' },
    { name: '\u901a\u77e5\u670d\u52a1',     desc: 'Realtime \u63a8\u9001\u5b8c\u6210\u4e8b\u4ef6' }
  ];
  drawL2Cards(slide, pres, theme, cols[1].x, L2_CARD_Y + 0.36, col_w, L2_CARD_H - 0.36,
    worker, theme.blue_light, theme.blue_mid, theme.primary);

  // Column 3: AI adapters
  drawL2ColumnHeader(slide, pres, theme, cols[2].x, L2_CARD_Y, col_w, cols[2].title);
  // Unified interface box (first)
  const ifaceY = L2_CARD_Y + 0.36;
  const ifaceH = 0.3;
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: cols[2].x, y: ifaceY, w: col_w, h: ifaceH,
    fill: { color: theme.white },
    line: { color: theme.blue_mid, width: 1 },
    rectRadius: 0.04
  });
  slide.addText('AIAdapter (\u7edf\u4e00\u63a5\u53e3)', {
    x: cols[2].x, y: ifaceY, w: col_w, h: ifaceH,
    fontSize: 10, fontFace: 'Microsoft YaHei', bold: true,
    color: theme.primary, align: 'center', valign: 'middle', margin: 0
  });
  // Adapter implementations
  const adapters = ['MetasoAdapter', 'KimiAdapter', 'ZhipuAdapter', 'OpenAI \u517c\u5bb9\u9002\u914d\u5668'];
  const adapAvail = L2_CARD_H - 0.36 - ifaceH - 0.05;
  const adapH = adapAvail / adapters.length;
  for (let i = 0; i < adapters.length; i++) {
    const ay = ifaceY + ifaceH + 0.03 + i * adapH;
    slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: cols[2].x, y: ay, w: col_w, h: adapH - 0.03,
      fill: { color: theme.blue_light },
      line: { color: theme.blue_mid, width: 1 },
      rectRadius: 0.04
    });
    slide.addText(adapters[i], {
      x: cols[2].x, y: ay, w: col_w, h: adapH - 0.03,
      fontSize: 9, fontFace: 'Microsoft YaHei',
      color: theme.primary, align: 'center', valign: 'middle', margin: 0
    });
  }

  // ============================================================
  // LAYER 3: \u6570\u636e\u4e0e\u5916\u90e8\u5c42  (y: 4.08 -> 5.39)
  // ============================================================
  const L3_Y = 4.08, L3_H = 1.31;
  drawLayerHeader(slide, pres, theme,
    L3_Y,
    '\u6570\u636e\u4e0e\u5916\u90e8\u5c42',
    theme.green_dark);

  const L3_CARD_Y = L3_Y + 0.32;
  const L3_CARD_H = L3_H - 0.36;

  // Supabase box (left, ~70%)
  const supX = 0.3, supW = 4.55;
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: supX, y: L3_CARD_Y, w: supW, h: L3_CARD_H,
    fill: { color: theme.green_light },
    line: { color: theme.green_mid, width: 1.5 },
    rectRadius: 0.06,
    shadow: { type: 'outer', color: '000000', blur: 4, offset: 1, angle: 90, opacity: 0.1 }
  });
  slide.addText('Supabase \u4e00\u4f53\u5316\u670d\u52a1', {
    x: supX, y: L3_CARD_Y + 0.03, w: supW, h: 0.28,
    fontSize: 12, fontFace: 'Microsoft YaHei', bold: true,
    color: theme.green_dark, align: 'center', valign: 'middle', margin: 0
  });
  slide.addShape(pres.shapes.LINE, {
    x: supX + 0.15, y: L3_CARD_Y + 0.33, w: supW - 0.3, h: 0,
    line: { color: theme.green_mid, width: 0.5 }
  });
  // 4 caps in 2x2 grid
  const caps = [
    { name: 'PostgreSQL',    desc: '8 \u5f20\u6838\u5fc3\u8868 \u00b7 RLS' },
    { name: 'Auth \u8ba4\u8bc1',     desc: '\u7528\u6237\u767b\u5f55\u4e0e\u8eab\u4efd\u7ba1\u7406' },
    { name: 'Storage \u5b58\u50a8',  desc: '\u4e13\u5229\u6587\u4ef6\u843d\u76d8' },
    { name: 'Realtime \u63a8\u9001', desc: '\u8fdb\u5ea6\u4e0e\u5b8c\u6210\u4e8b\u4ef6\u8ba2\u9605' }
  ];
  const capY0 = L3_CARD_Y + 0.38;
  const capAvail = L3_CARD_H - 0.42;
  const capW = (supW - 0.3) / 2;
  const capH = (capAvail - 0.06) / 2;
  for (let i = 0; i < caps.length; i++) {
    const r = Math.floor(i / 2), c = i % 2;
    const cx = supX + 0.1 + c * (capW + 0.1);
    const cy = capY0 + r * (capH + 0.06);
    slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: cx, y: cy, w: capW, h: capH,
      fill: { color: theme.white },
      line: { color: theme.green_mid, width: 0.5 },
      rectRadius: 0.04
    });
    slide.addText(caps[i].name, {
      x: cx, y: cy + 0.02, w: capW, h: capH * 0.45,
      fontSize: 9, fontFace: 'Microsoft YaHei', bold: true,
      color: theme.green_dark, align: 'center', valign: 'middle', margin: 0
    });
    slide.addText(caps[i].desc, {
      x: cx, y: cy + capH * 0.45, w: capW, h: capH * 0.5,
      fontSize: 7, fontFace: 'Microsoft YaHei',
      color: theme.secondary, align: 'center', valign: 'middle', margin: 0
    });
  }

  // External AI box (right, ~30%)
  const extX = 5.0, extW = 2.0;
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: extX, y: L3_CARD_Y, w: extW, h: L3_CARD_H,
    fill: { color: theme.white },
    line: { color: theme.gray_text, width: 1 },
    rectRadius: 0.06,
    shadow: { type: 'outer', color: '000000', blur: 4, offset: 1, angle: 90, opacity: 0.1 }
  });
  slide.addText('\u5916\u90e8 AI \u670d\u52a1', {
    x: extX, y: L3_CARD_Y + 0.02, w: extW, h: 0.22,
    fontSize: 11, fontFace: 'Microsoft YaHei', bold: true,
    color: theme.gray_text, align: 'center', valign: 'middle', margin: 0
  });
  slide.addShape(pres.shapes.LINE, {
    x: extX + 0.15, y: L3_CARD_Y + 0.26, w: extW - 0.3, h: 0,
    line: { color: theme.gray_line, width: 0.5 }
  });
  const extLines = [
    'Metaso \u79d8\u5854\u4e13\u4e1a\u641c\u7d22',
    'Kimi \u6708\u4e4b\u6697\u9762',
    '\u667a\u8c31 GLM',
    'OpenAI \u517c\u5bb9\u63a5\u53e3'
  ];
  let ey = L3_CARD_Y + 0.3;
  for (const ln of extLines) {
    slide.addText(ln, {
      x: extX + 0.05, y: ey, w: extW - 0.1, h: 0.18,
      fontSize: 9, fontFace: 'Microsoft YaHei',
      color: theme.secondary, align: 'center', valign: 'middle', margin: 0
    });
    ey += 0.18;
  }
  slide.addText('(\u6309\u6a21\u578b\u914d\u7f6e\u52a8\u6001\u9009\u62e9)', {
    x: extX + 0.05, y: ey, w: extW - 0.1, h: 0.16,
    fontSize: 7, fontFace: 'Microsoft YaHei', italic: true,
    color: theme.gray_sub, align: 'center', valign: 'middle', margin: 0
  });

  // Realtime dashed line (Worker -> Supabase Realtime cap)
  // Worker column center bottom: x = cols[1].x + col_w/2, y = L2_CARD_Y + L2_CARD_H
  const wSrcX = cols[1].x + col_w / 2;
  const wSrcY = L2_CARD_Y + L2_CARD_H;
  // Realtime cap (row 1, col 1 in 2x2): i=3
  const rtR = 1, rtC = 1;
  const rtCx = supX + 0.1 + rtC * (capW + 0.1) + capW / 2;
  const rtCy = capY0 + rtR * (capH + 0.06);
  const rtTgtX = rtCx;
  const rtTgtY = rtCy - capH / 2;
  drawDashedLine(slide, pres, theme, wSrcX, wSrcY, rtTgtX, rtTgtY, theme.blue_mid);

  // ============================================================
  // RIGHT CARD: \u6838\u5fc3\u6570\u636e\u6d41 (7 \u6b65)
  // ============================================================
  const CARD_X = 7.15, CARD_W = 2.55;
  const CARD_Y = 0.7, CARD_H = 4.69;
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: CARD_X, y: CARD_Y, w: CARD_W, h: CARD_H,
    fill: { color: theme.white },
    line: { color: theme.orange_mid, width: 1.5 },
    rectRadius: 0.08,
    shadow: { type: 'outer', color: '000000', blur: 4, offset: 1, angle: 90, opacity: 0.1 }
  });
  // Title bar (orange)
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: CARD_X, y: CARD_Y, w: CARD_W, h: 0.45,
    fill: { color: theme.orange_dark }, line: { type: 'none' },
    rectRadius: 0.08
  });
  // Cover bottom corners of title bar so they don't show rounding on the bottom
  slide.addShape(pres.shapes.RECTANGLE, {
    x: CARD_X, y: CARD_Y + 0.3, w: CARD_W, h: 0.15,
    fill: { color: theme.orange_dark }, line: { type: 'none' }
  });
  slide.addText('\u6838\u5fc3\u6570\u636e\u6d41 (7 \u6b65)', {
    x: CARD_X, y: CARD_Y, w: CARD_W, h: 0.45,
    fontSize: 13, fontFace: 'Microsoft YaHei', bold: true,
    color: theme.white, align: 'center', valign: 'middle', margin: 0
  });

  // 7 steps
  const stepsData = [
    '\u7528\u6237\u4e0a\u4f20\u4e13\u5229\u6587\u4ef6',
    '\u524d\u7aef\u521b\u5efa\u89e3\u6790\u4efb\u52a1, \u6587\u4ef6\u5165\u961f',
    'Worker \u89e3\u6790\u6587\u6863, AI \u62bd\u53d6\u7ed3\u6784\u5316\u5b57\u6bb5',
    '\u524d\u7aef\u914d\u7f6e\u68c0\u7d22\u4efb\u52a1 (\u6a21\u578b x \u7b56\u7565)',
    'Worker \u5e76\u884c\u68c0\u7d22, \u591a AI \u9002\u914d\u5668\u5e76\u53d1',
    'AI \u9009 Top-N, \u751f\u6210\u8def\u5f84\u6458\u8981\u4e0e\u62a5\u544a',
    'Realtime \u63a8\u9001\u5b8c\u6210, \u7528\u6237\u67e5\u770b\u62a5\u544a'
  ];
  const stepStartY = CARD_Y + 0.6;
  const stepH = (CARD_H - 0.7) / 7;
  for (let i = 0; i < 7; i++) {
    const sy = stepStartY + i * stepH;
    const cy = sy + stepH / 2;
    // circle
    slide.addShape(pres.shapes.OVAL, {
      x: CARD_X + 0.18, y: cy - 0.18, w: 0.36, h: 0.36,
      fill: { color: theme.orange_mid },
      line: { color: theme.white, width: 1 }
    });
    // circled number via Unicode
    const circled = ['\u2460', '\u2461', '\u2462', '\u2463', '\u2464', '\u2465', '\u2466'][i];
    slide.addText(circled, {
      x: CARD_X + 0.18, y: cy - 0.18, w: 0.36, h: 0.36,
      fontSize: 14, fontFace: 'Arial', bold: true,
      color: theme.white, align: 'center', valign: 'middle', margin: 0
    });
    // step text
    slide.addText(stepsData[i], {
      x: CARD_X + 0.6, y: sy + 0.05, w: CARD_W - 0.7, h: stepH - 0.1,
      fontSize: 9, fontFace: 'Microsoft YaHei',
      color: theme.secondary, valign: 'middle', margin: 0
    });
    // separator line
    if (i < 6) {
      slide.addShape(pres.shapes.LINE, {
        x: CARD_X + 0.2, y: sy + stepH - 0.02, w: CARD_W - 0.4, h: 0,
        line: { color: 'EEEEEE', width: 0.5 }
      });
    }
  }

  // ============================================================
  // PAGE NUMBER
  // ============================================================
  slide.addText('1', {
    x: 9.5, y: 5.4, w: 0.3, h: 0.15,
    fontSize: 8, fontFace: 'Arial',
    color: theme.gray_sub, align: 'right', valign: 'middle', margin: 0
  });
}

// ===== Helper: draw layer header bar =====
function drawLayerHeader(slide, pres, theme, y, title, accentColor) {
  const x = 0.3, w = 6.7;
  // accent block
  slide.addShape(pres.shapes.RECTANGLE, {
    x: x, y: y + 0.04, w: 0.06, h: 0.22,
    fill: { color: accentColor }, line: { type: 'none' },
    rectRadius: 0.02
  });
  // title text
  slide.addText(title, {
    x: x + 0.12, y: y, w: w - 0.12, h: 0.3,
    fontSize: 11, fontFace: 'Microsoft YaHei', bold: true,
    color: accentColor, valign: 'middle', margin: 0
  });
  // underline
  slide.addShape(pres.shapes.LINE, {
    x: x + 0.12, y: y + 0.3, w: w - 0.12, h: 0,
    line: { color: theme.gray_line, width: 0.5 }
  });
}

// ===== Helper: draw L2 column header (dark filled bar) =====
function drawL2ColumnHeader(slide, pres, theme, x, y, w, title) {
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: x, y: y, w: w, h: 0.3,
    fill: { color: theme.primary }, line: { type: 'none' },
    rectRadius: 0.04
  });
  slide.addText(title, {
    x: x, y: y, w: w, h: 0.3,
    fontSize: 11, fontFace: 'Microsoft YaHei', bold: true,
    color: theme.white, align: 'center', valign: 'middle', margin: 0
  });
}

// ===== Helper: draw a stack of small cards inside an L2 column =====
function drawL2Cards(slide, pres, theme, x, y, w, h, items, fillColor, strokeColor, nameColor) {
  const n = items.length;
  const cardH = (h - (n - 1) * 0.06) / n;
  for (let i = 0; i < n; i++) {
    const cy = y + i * (cardH + 0.06);
    slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: x, y: cy, w: w, h: cardH,
      fill: { color: fillColor },
      line: { color: strokeColor, width: 1 },
      rectRadius: 0.04
    });
    slide.addText(items[i].name, {
      x: x, y: cy + 0.02, w: w, h: cardH * 0.5,
      fontSize: 10, fontFace: 'Microsoft YaHei', bold: true,
      color: nameColor, align: 'center', valign: 'middle', margin: 0
    });
    slide.addText(items[i].desc, {
      x: x, y: cy + cardH * 0.5, w: w, h: cardH * 0.5 - 0.02,
      fontSize: 8, fontFace: 'Microsoft YaHei',
      color: theme.secondary, align: 'center', valign: 'middle', margin: 0
    });
  }
}

// ===== Helper: dashed line approximation (4 short segments) =====
function drawDashedLine(slide, pres, theme, x1, y1, x2, y2, color) {
  const dx = x2 - x1, dy = y2 - y1;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const dashLen = 0.12, gapLen = 0.08;
  const segments = Math.floor(dist / (dashLen + gapLen));
  for (let i = 0; i < segments; i++) {
    const t1 = (i * (dashLen + gapLen)) / dist;
    const t2 = Math.min(((i * (dashLen + gapLen)) + dashLen) / dist, 1.0);
    const sx = x1 + t1 * dx, sy = y1 + t1 * dy;
    const ex = x1 + t2 * dx, ey = y1 + t2 * dy;
    slide.addShape(pres.shapes.LINE, {
      x: sx, y: sy, w: ex - sx, h: ey - sy,
      line: { color: color, width: 1.5 }
    });
  }
}

module.exports = { createSlide };
