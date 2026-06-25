import React from "react";
import {
  AbsoluteFill,
  Easing,
  Img,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { loadFont } from "@remotion/google-fonts/NotoSansSC";

const { fontFamily } = loadFont("normal", {
  weights: ["400", "700"],
  subsets: ["latin"],
});

const PALETTE = {
  bg: "#07101d",
  panel: "#0e1a2b",
  border: "rgba(255,255,255,0.08)",
  muted: "#9fb1c9",
  text: "#f4f8fc",
  accent: "#5ce0d8",
  accentSoft: "rgba(92,224,216,0.14)",
  warn: "#f7b955",
  success: "#7ce3a6",
  blue: "#6aa6ff",
} as const;

const easeOut = Easing.bezier(0.16, 1, 0.3, 1);
const easeSoft = Easing.bezier(0.22, 1, 0.36, 1);
const easeSnap = Easing.bezier(0.34, 1.2, 0.64, 1);

const Wrapper: React.FC<{ readonly children: React.ReactNode }> = ({
  children,
}) => (
  <AbsoluteFill
    style={{
      fontFamily,
      color: PALETTE.text,
      backgroundColor: PALETTE.bg,
      padding: 72,
      backgroundImage:
        "radial-gradient(circle at 20% 25%, rgba(92,224,216,0.06), transparent 38%), radial-gradient(circle at 80% 70%, rgba(106,166,255,0.05), transparent 36%)",
    }}
  >
    {children}
  </AbsoluteFill>
);

const Panel: React.FC<{
  readonly style?: React.CSSProperties;
  readonly children: React.ReactNode;
}> = ({ style, children }) => (
  <div
    style={{
      backgroundColor: PALETTE.panel,
      border: `1px solid ${PALETTE.border}`,
      borderRadius: 24,
      boxShadow: "0 24px 64px rgba(0,0,0,0.35)",
      ...style,
    }}
  >
    {children}
  </div>
);

const Tag: React.FC<{
  readonly color: string;
  readonly children: React.ReactNode;
}> = ({ color, children }) => (
  <span
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 10,
      borderRadius: 999,
      padding: "8px 16px",
      backgroundColor: `${color}18`,
      color,
      fontSize: 22,
      fontWeight: 700,
      letterSpacing: 0.6,
    }}
  >
    {children}
  </span>
);

const Title: React.FC<{ readonly children: React.ReactNode }> = ({
  children,
}) => (
  <div style={{ fontSize: 44, fontWeight: 700, lineHeight: 1.18 }}>
    {children}
  </div>
);

const Subtitle: React.FC<{ readonly children: React.ReactNode }> = ({
  children,
}) => (
  <div style={{ color: PALETTE.muted, fontSize: 25, lineHeight: 1.65 }}>
    {children}
  </div>
);

const Bar: React.FC<{
  readonly label: string;
  readonly value: number;
  readonly color: string;
  readonly frame: number;
  readonly start: number;
}> = ({ label, value, color, frame, start }) => {
  const reveal = interpolate(frame, [start, start + 26], [0, 1], {
    easing: easeOut,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div style={{ display: "grid", gridTemplateColumns: "160px 1fr 64px", gap: 18, alignItems: "center" }}>
      <div style={{ color: PALETTE.muted, fontSize: 22 }}>{label}</div>
      <div
        style={{
          height: 18,
          borderRadius: 12,
          backgroundColor: "rgba(255,255,255,0.06)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${value * reveal}%`,
            height: "100%",
            borderRadius: 12,
            backgroundColor: color,
          }}
        />
      </div>
      <div style={{ textAlign: "right", fontWeight: 700, color }}>
        {Math.round(value * reveal)}%
      </div>
    </div>
  );
};

const DotStep: React.FC<{
  readonly index: number;
  readonly frame: number;
  readonly label: string;
  readonly desc: string;
  readonly color: string;
}> = ({ index, frame, label, desc, color }) => {
  const delay = 12 + index * 10;
  const appear = interpolate(frame, [delay, delay + 18], [0, 1], {
    easing: easeSoft,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const move = interpolate(appear, [0, 1], [26, 0]);
  const active = frame >= delay;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 18,
        opacity: appear,
        transform: `translateY(${move}px)`,
      }}
    >
      <div
        style={{
          width: 24,
          height: 24,
          marginTop: 6,
          borderRadius: 999,
          backgroundColor: active ? color : "rgba(255,255,255,0.10)",
          boxShadow: active ? `0 0 16px ${color}` : "none",
        }}
      />
      <div>
        <div style={{ fontWeight: 700, fontSize: 26 }}>{label}</div>
        <div style={{ color: PALETTE.muted, fontSize: 21 }}>{desc}</div>
      </div>
    </div>
  );
};

const SmallMetric: React.FC<{
  readonly label: string;
  readonly value: string;
  readonly color: string;
  readonly frame: number;
  readonly start: number;
}> = ({ label, value, color, frame, start }) => {
  const reveal = interpolate(frame, [start, start + 16], [0, 1], {
    easing: easeSnap,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        padding: 22,
        borderRadius: 20,
        border: `1px solid ${color}30`,
        backgroundColor: `${color}0f`,
        opacity: reveal,
        transform: `translateY(${interpolate(reveal, [0, 1], [14, 0])}px)`,
      }}
    >
      <div style={{ color: PALETTE.muted, fontSize: 19 }}>{label}</div>
      <div style={{ fontSize: 30, fontWeight: 700, marginTop: 8, color }}>{value}</div>
    </div>
  );
};

export const MyComposition: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const headerOpacity = interpolate(frame, [8, 28], [0, 1], {
    easing: easeSoft,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const headerY = interpolate(frame, [8, 28], [18, 0], {
    easing: easeSoft,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <Wrapper>
      <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            opacity: headerOpacity,
            transform: `translateY(${headerY}px)`,
          }}
        >
          <div>
            <Tag color={PALETTE.accent}>AI-assisted patent examination</Tag>
            <div style={{ marginTop: 18, fontSize: 58, fontWeight: 700 }}>
              AI 辅助专利审查演示
            </div>
            <Subtitle>
              Automated prior art retrieval, claim-element mapping, and examiner-ready review summaries.
            </Subtitle>
          </div>
          <Panel
            style={{
              width: 410,
              padding: 28,
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            <Title>审查辅助概览</Title>
            <Subtitle>
              Combine global patent databases, non-patent literature, and semantic evidence into one review workflow.
            </Subtitle>
            <SmallMetric label="检索速度" value="快 5.8x" color={PALETTE.accent} frame={frame} start={36} />
            <SmallMetric label="对比文件命中" value="+42%" color={PALETTE.blue} frame={frame} start={48} />
            <SmallMetric label="初筛工作量下降" value="-61%" color={PALETTE.success} frame={frame} start={60} />
          </Panel>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: 32 }}>
          <Panel style={{ padding: 34, display: "flex", flexDirection: "column", gap: 24 }}>
            <Title>关键流程</Title>
            <Subtitle>
              The assistant structures examination into four review-oriented stages.
            </Subtitle>
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <DotStep index={0} frame={frame} label="输入解析" desc="Extract claims, description, and technical problem" color={PALETTE.accent} />
              <DotStep index={1} frame={frame} label="多源检索" desc="Patent, NPL, and semantic retrieval combined" color={PALETTE.blue} />
              <DotStep index={2} frame={frame} label="证据映射" desc="Match prior art to claim elements and novelty points" color={PALETTE.warn} />
              <DotStep index={3} frame={frame} label="审查摘要" desc="Generate examiner-ready analysis and reasoning" color={PALETTE.success} />
            </div>
          </Panel>

          <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
            <Panel style={{ padding: 34, display: "flex", flexDirection: "column", gap: 22 }}>
              <Title>效果指标</Title>
              <Subtitle>Illustrative review metrics for the demo workflow.</Subtitle>
              <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                <Bar label="检索覆盖" value={92} color={PALETTE.accent} frame={frame} start={42} />
                <Bar label="相关证据" value={85} color={PALETTE.warn} frame={frame} start={54} />
                <Bar label="一致性检查" value={96} color={PALETTE.success} frame={frame} start={66} />
              </div>
            </Panel>

            <Panel style={{ padding: 34, display: "flex", flexDirection: "column", gap: 18 }}>
              <Title>输出说明</Title>
              <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
                <Tag color={PALETTE.accent}>检索报告</Tag>
                <Tag color={PALETTE.warn}>对比矩阵</Tag>
                <Tag color={PALETTE.blue}>权利要求映射</Tag>
                <Tag color={PALETTE.success}>审查建议</Tag>
              </div>
              <Subtitle>
                Designed to help examiners quickly locate the closest prior art and justify novelty/inventive-step judgments.
              </Subtitle>
            </Panel>
          </div>
        </div>
      </div>
    </Wrapper>
  );
};
