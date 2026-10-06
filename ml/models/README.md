# ML2.2 — First classifier

At the user's explicit request, `first_classifier.py` now implements the three
contracts. Ten active tests verify them; no skip flag remains. Model behaviour
is intentionally small enough to inspect. Grouped evaluation is a later step.

## First: majority baseline

`majority_label(labels)` validates labels, counts each class, selects the
largest count, break ties alphabetically. An empty list is an error. This is
a useful minimum: a learned model must do better than predicting one frequent
class. On each CV fold count only that fold's training rows.

## Then: heading baseline

`heading_prediction(weak_label)` returns a valid existing weak label or
`None`. A missing heading is abstention, not `other`. Later compare this on
independent human labels and report abstention/coverage separately.

Do not claim success by checking the heading baseline against the same weak
labels it produced; that comparison is circular. Prose definitions in the hand
sample are the important cases where it may abstain. The original extraction
stores weak labels; the human-labelling input intentionally does not.

## Finally: heading-free TF-IDF + logistic regression

`fit_tfidf_classifier(texts, labels, seed)` uses the already installed
scikit-learn (1.6.1 on this machine); there is no installation step.

1. Validate matching lengths, nonempty texts, known labels and at least two
   distinct classes. Never substitute full block text for missing bodies.
2. Build a `Pipeline` with steps `tfidf` and `classifier`.
3. Starter vectoriser: `TfidfVectorizer(ngram_range=(1, 2), min_df=1)`.
   Starter classifier: `LogisticRegression(C=1.0, max_iter=1000,
   random_state=seed)`. Keep default class weighting for this first baseline.
4. Fit on the supplied training texts/labels and return the fitted pipeline.
   Do not fit or refit the vocabulary on development examples.

TF-IDF gives each document a weighted word/bigram vector; logistic regression
learns class scores from that vector. A Pipeline keeps vocabulary fitting tied
to the training portion of each fold. A held-out-only word must not enter the
vocabulary merely because you predicted that document.

Run the active acceptance tests:

```powershell
python -m pytest ml/tests/test_classifier_exercise.py -v -p no:cacheprovider
```

All ten model tests pass, including toy-set learning and independent vocabularies
across fits. A disposable fit on the 548 training rows learned seven classes
and 15,169 word/bigram features; its majority baseline is `example` (131 rows).
No model artifact was saved and no held-out score was computed. The later runner
will select four train folds and hold one out, repeating for all five. Fit a
fresh pipeline each time. Aggregate out-of-fold predictions and expose absent
classes; the existing fold sizes are 200/200/57/46/45, not balanced.

Use only `ml/out/ml2/train_blocks.jsonl` for development. Do not inspect or fit
on hand-labelled test rows. No gold performance or model artifact exists yet.
Model implementation acceptance is separate from final quality acceptance,
which still needs grouped CV and independent human labels.
Multinomial Naive Bayes, LightGBM, BM25 and gold evaluation are later steps.

ML2.4 follow-up: `fit_tfidf_naive_bayes` is now implemented, using the same
validated inputs and vectoriser via a shared `_fit_tfidf` helper. NB uses fixed
`alpha=1.0`. The optional grouped runner compares it without overwriting the
original logistic report. LightGBM, BM25 and gold evaluation remain later work.

## ML2.5 — Layout-only LightGBM

`layout_classifier.py` allowlists five numeric measurements (`FEATURES`) and
document category. It never uses text, page number, identity or label as input.
`DictVectorizer` learns category columns only from each training fold; an unseen
category produces zero category columns at prediction without changing vocabulary.
The native LightGBM API fits 100 multiclass boosting rounds, learning rate 0.05,
15 leaves, minimum 10 rows per leaf, seed 20261006 and two threads. Deterministic
column-wise training is enabled; there is no class weighting or score-based tuning.
Sorted observed training labels map to numeric IDs and back to class strings.
Classes absent from a training fold cannot be predicted by that fold's model.

LightGBM is a specialized tree implementation, not a hand-written learner.
Its dependency is pinned to 4.7.0 in `requirements.txt`. The project-local
`.venv-ml` reuses installed scientific packages and is ignored by Git.
Verbosity -1 disables repetitive tree-building informational messages; malformed
features still raise explicit errors and Python warnings are not suppressed.
Layout-only performance is worse than text models; no deployment or saved model.

## ML2.6 — Two fixed text candidates

`improved_classifier.py` tests (1) the original word/bigram logistic model with
`class_weight="balanced"`, and (2) that balanced model with an equal-weight
FeatureUnion of word/bigrams and within-word character 3–5-grams (`min_df=2`).
Both keep C=1, seed 20261006 and max_iter=1000. Every vocabulary and class weight
is learned from that fold's training inputs only. No dependency or model artifact
was added. These were two specified candidates, not a parameter grid.

Balanced weighting inversely scales by training class frequency; see the
[scikit-learn 1.6 reference](https://scikit-learn.org/1.6/modules/generated/sklearn.linear_model.LogisticRegression.html).
Character features were a hypothesis for fragmented PDF words, not an extraction
repair. Their behavior follows the
[TF-IDF reference](https://scikit-learn.org/1.6/modules/generated/sklearn.feature_extraction.text.TfidfVectorizer.html).
They did not beat balanced word features in this run. Balanced words improve macro
F1 and definition recall but trade away definition precision and do not beat NB
accuracy. This is a provisional development candidate, not a production selection.
