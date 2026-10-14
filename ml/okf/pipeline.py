"""ML3: the frozen block-understanding pipeline as one saved object.

Same components and settings as the ML2.15 gold run (ml/eval/gold_pipeline.py):
  * headed block   -> heading rule (weak label from the extractor);
  * unheaded block -> sentence detector D2 says "definition" at score >= 0.4,
                      otherwise variant C (stacked LightGBM + reliable negatives)
                      gives the role, with its own "definition" demoted to other.

Training uses all training sources and never a frozen test group. The saved
artefact contains a TF-IDF vocabulary learned from copyrighted text, so it lives
in the git-ignored ml/models/artifacts/ folder.

    python -m ml.okf.pipeline          # train and save (about two minutes)
"""

import argparse
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

ARTIFACT = Path("ml/models/artifacts/okf_pipeline.joblib")
THRESHOLD = 0.4
VERSION = "0.1"


@dataclass
class Decision:
    block_id: str
    role: str                 # merged role: definition, theorem, proof, example, algorithm, other
    contains_definition: bool
    method: str               # "heading", "detector" or "classifier"
    score: float              # detector score for unheaded blocks, 1.0 for headed blocks
    sentence: str | None      # defining sentence found by the detector
    sentences: tuple = ()     # every (sentence, score) at or above the threshold, best first


class FrozenPipeline:
    def __init__(self, classifier, detector, threshold=THRESHOLD, trained_at=None, training=None):
        self.classifier, self.detector, self.threshold = classifier, detector, threshold
        self.trained_at, self.training = trained_at, training or {}

    def classify(self, blocks, emphasis=None):
        """Decide every block of one document; `blocks` are extractor records in reading order."""
        from ml.eval.label_scheme import merge_label
        from ml.eval.unheaded_cv import block_row
        from ml.models.definition_features import attach_context
        from ml.models.prose_definitions import block_sentences
        emphasis = emphasis or {}
        unheaded = [b for b in blocks if not b.get("weak_label")]
        rows = attach_context([{**block_row(b), "label": "other"} for b in unheaded], blocks) if unheaded else []
        roles = dict(zip([b["block_id"] for b in unheaded], self.classifier.predict(rows))) if rows else {}
        decisions = []
        for block in blocks:
            if block.get("weak_label"):
                role = merge_label(block["weak_label"])
                decisions.append(Decision(block["block_id"], role, role == "definition", "heading", 1.0, None))
                continue
            pairs = block_sentences(block, emphasis.get(block["block_id"], []))
            scores = self.detector.sentence_scores([s for s, _ in pairs], [f for _, f in pairs])
            best = max(range(len(scores)), key=scores.__getitem__) if scores else None
            score = scores[best] if scores else 0.0
            if score >= self.threshold:
                found = sorted(((pairs[i][0], scores[i]) for i in range(len(scores)) if scores[i] >= self.threshold),
                               key=lambda item: -item[1])
                decisions.append(Decision(block["block_id"], "definition", True, "detector", score, pairs[best][0],
                                          tuple(found)))
            else:
                role = roles[block["block_id"]]
                decisions.append(Decision(block["block_id"], "other" if role == "definition" else role,
                                          False, "classifier", score, None))
        return decisions

    def save(self, path=ARTIFACT):
        import joblib
        path.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump(self, path)

    @staticmethod
    def load(path=ARTIFACT):
        import joblib
        return joblib.load(path)


def train(train_rows_path, context_path, emphasis_path):
    """Fit the frozen pipeline on all training data, exactly as in ML2.15."""
    from ml.eval.classifier_cv import source_weights
    from ml.eval.gold_eval import read_jsonl
    from ml.eval.label_scheme import merge_label
    from ml.eval.prose_definition_cv import training_sentences
    from ml.eval.unheaded_cv import block_row, negative_pool, sample_negatives
    from ml.models.definition_features import attach_context, fit_stacked_lightgbm
    from ml.models.prose_definitions import fit_sentence_detector
    train = [{**r, "label": merge_label(r["label"])} for r in read_jsonl(train_rows_path)]
    context = read_jsonl(context_path)
    test_groups = set(json.loads(Path("ml/splits.json").read_text(encoding="utf-8"))["test_groups"])
    if {r["group"] for r in train} & test_groups or {b["group"] for b in context} & test_groups:
        raise ValueError("Training data contains a frozen test group")
    terms = {x["block_id"]: x["emphasis"] for x in read_jsonl(emphasis_path)}
    folds = {r["group"]: r["fold"] for r in train}
    groups = set(folds)
    headed = attach_context(train, context)
    counts = {}
    for row in train:
        counts[row["group"]] = counts.get(row["group"], 0) + 1
    pool = negative_pool(context, folds, set(), "reliable_negatives")
    negatives = attach_context([{**block_row(b), "label": "other"} for b in sample_negatives(pool, counts, groups)],
                               context)
    data = headed + negatives
    classifier = fit_stacked_lightgbm(data, [r["label"] for r in data], sample_weight=source_weights(data))
    sentences = training_sentences(train, context, [], terms, groups, set(), False, True, folds)
    detector = fit_sentence_detector([s[0] for s in sentences], [s[1] for s in sentences], [s[2] for s in sentences],
                                     sample_weight=source_weights([{"group": s[3]} for s in sentences]))
    return FrozenPipeline(classifier, detector, THRESHOLD,
                          trained_at=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                          training={"headed_rows": len(train), "reliable_negatives": len(negatives),
                                    "detector_sentences": len(sentences), "sources": len(groups)})


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--train-rows", type=Path, default=Path("ml/out/arxiv_expansion/train_blocks.jsonl"))
    parser.add_argument("--context-blocks", type=Path, default=Path("ml/out/arxiv_expansion/context_blocks.jsonl"))
    parser.add_argument("--emphasis", type=Path, default=Path("ml/out/ml214/emphasis_train.jsonl"))
    parser.add_argument("--out", type=Path, default=ARTIFACT)
    args = parser.parse_args()
    pipeline = train(args.train_rows, args.context_blocks, args.emphasis)
    pipeline.save(args.out)
    print(f"Saved {args.out}: {pipeline.training}")


if __name__ == "__main__":
    # Run through the importable module so the pickle records ml.okf.pipeline.FrozenPipeline, not __main__.
    from ml.okf.pipeline import main as module_main
    module_main()
