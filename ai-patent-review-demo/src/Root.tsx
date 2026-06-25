import "./index.css";
import { Composition } from "remotion";
import { MyComposition } from "./Composition";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="AiPatentReviewDemo"
        component={MyComposition}
        durationInFrames={210}
        fps={30}
        width={1280}
        height={720}
      />
    </>
  );
};
