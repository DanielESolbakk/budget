import React from "react";

export type ImportWorkflowStage =
  | "select-file"
  | "map-and-validate"
  | "review"
  | "confirm"
  | "complete";

const stages: Array<{ id: Exclude<ImportWorkflowStage, "complete">; label: string }> = [
  { id: "select-file", label: "Select file" },
  { id: "map-and-validate", label: "Map and validate" },
  { id: "review", label: "Review" },
  { id: "confirm", label: "Confirm" },
];

interface ImportStageProgressProps {
  format: "CSV" | "PDF";
  stage: ImportWorkflowStage;
}

export function ImportStageProgress({ format, stage }: ImportStageProgressProps): React.JSX.Element {
  const currentIndex = stage === "complete"
    ? stages.length - 1
    : stages.findIndex((item) => item.id === stage);

  return (
    <nav className="import-stage-progress" aria-label={`${format} import stages`}>
      <ol aria-label={`${format} import progress`}>
        {stages.map((item, index) => {
          const isComplete = stage === "complete" || index < currentIndex;
          const isCurrent = stage !== "complete" && index === currentIndex;
          const stateLabel = isComplete ? "Complete" : isCurrent ? "Current" : "Next";

          return (
            <li
              key={item.id}
              data-state={isComplete ? "complete" : isCurrent ? "current" : "next"}
              aria-current={isCurrent ? "step" : undefined}
            >
              <span className="import-stage-number" aria-hidden="true">{index + 1}</span>
              <span>
                <strong>{item.label}</strong>
                <small>{stateLabel}</small>
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}