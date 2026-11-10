import {
  CheckCircle,
  AlertCircle,
  TrendingUp,
  Lightbulb,
  BarChart3,
  Target,
  Zap,
} from "lucide-react";

interface FeedbackPanelProps {
  score: number;
  strengths: string[];
  improvements: string[];
  aiComment: string;
  skillCategory?: string;
  dimensions?: { id: string; name: string; score: number }[];
}

const FeedbackPanel = ({
  score,
  strengths,
  improvements,
  aiComment,
  dimensions = [],
}: FeedbackPanelProps) => {
  // 根据得分确定等级
  const getScoreLevel = (score: number) => {
    if (score >= 90)
      return {
        level: "优秀",
        color: "text-emerald-500",
        bgColor: "bg-emerald-50",
      };
    if (score >= 80)
      return { level: "良好", color: "text-blue-500", bgColor: "bg-blue-50" };
    if (score >= 70)
      return { level: "中等", color: "text-amber-500", bgColor: "bg-amber-50" };
    if (score >= 60)
      return {
        level: "及格",
        color: "text-orange-500",
        bgColor: "bg-orange-50",
      };
    return { level: "需要努力", color: "text-red-500", bgColor: "bg-red-50" };
  };

  const scoreLevel = getScoreLevel(score);

  return (
    <div className="animate-fade-in bg-card border border-border rounded-xl p-6 shadow-custom">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-xl font-bold flex items-center gap-2">
          <TrendingUp className="text-primary" />
          本次交付物评估
        </h3>
        <div className="flex flex-col items-end">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">本次任务评分</span>
            <span className="text-3xl font-bold text-primary">{score}</span>
            <span className="text-sm text-muted-foreground">/ 100</span>
          </div>
          <span
            className={`text-sm font-medium px-2 py-1 rounded-full ${scoreLevel.color} ${scoreLevel.bgColor}`}
          >
            {scoreLevel.level}
          </span>
        </div>
      </div>

      {/* 评分维度 */}
      <div className="mb-6">
        <h4 className="font-semibold mb-3 flex items-center gap-2 text-foreground">
          <BarChart3 size={18} className="text-primary" />
          评分维度
        </h4>
        <div className="space-y-3">
          {dimensions.length === 0 && (
            <p className="text-sm text-muted-foreground">
              这条记录未保存分项评分。
            </p>
          )}
          {dimensions.map((dimension) => (
            <div key={dimension.id} className="space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-foreground/80">{dimension.name}</span>
                <span className="font-medium">{dimension.score}</span>
              </div>
              <div className="w-full bg-secondary rounded-full h-2">
                <div
                  className="h-2 rounded-full bg-primary"
                  style={{ width: `${dimension.score}%` }}
                ></div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mb-6 p-4 bg-primary/5 rounded-lg border border-primary/10">
        <h4 className="flex items-center gap-2 font-semibold text-primary mb-2">
          <Lightbulb size={18} />
          智能点评
        </h4>
        <p className="text-foreground/80 leading-relaxed text-sm">
          {aiComment}
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <h4 className="font-semibold mb-3 flex items-center gap-2 text-emerald-600">
            <CheckCircle size={18} /> 表现亮点
          </h4>
          <ul className="space-y-3">
            {strengths.length > 0 ? (
              strengths.map((item, idx) => (
                <li
                  key={idx}
                  className="flex gap-2 text-sm text-foreground/80 p-3 bg-emerald-50 rounded-lg"
                >
                  <Zap size={16} className="text-emerald-500 mt-0.5 shrink-0" />
                  <span>{item}</span>
                </li>
              ))
            ) : (
              <li className="text-sm text-muted-foreground">
                本次未记录亮点。
              </li>
            )}
          </ul>
        </div>
        <div>
          <h4 className="font-semibold mb-3 flex items-center gap-2 text-amber-600">
            <AlertCircle size={18} /> 提升建议
          </h4>
          <ul className="space-y-3">
            {improvements.length > 0 ? (
              improvements.map((item, idx) => (
                <li
                  key={idx}
                  className="flex gap-2 text-sm text-foreground/80 p-3 bg-amber-50 rounded-lg"
                >
                  <Target
                    size={16}
                    className="text-amber-500 mt-0.5 shrink-0"
                  />
                  <span>{item}</span>
                </li>
              ))
            ) : (
              <li className="text-sm text-muted-foreground">
                本次未记录改进建议。
              </li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
};

export default FeedbackPanel;
