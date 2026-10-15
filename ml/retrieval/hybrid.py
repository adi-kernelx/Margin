"""ML3.2: lexical + dense hybrid retrieval with reciprocal rank fusion.

BM25 is written out here (no search library) so the scoring is inspectable:
    idf(t)   = ln(1 + (N - df + 0.5) / (df + 0.5))
    score    = sum_t idf(t) * tf * (k1 + 1) / (tf + k1 * (1 - b + b * len / avg_len))
Reciprocal rank fusion (Cormack et al., 2009) merges rankings by position only:
    rrf(d)   = sum_r w_r / (k + rank_r(d)),   k = 60
so BM25 scores and cosine similarities never have to share a scale.

Items are passages (text chunks) and, optionally, OKF concepts; every item
carries the page it points to, so a concept hit counts as a page hit.
"""

import math
import re
from collections import Counter

import numpy as np

# Small English stoplist: function words only, so "set", "map" or "order" still count.
STOPWORDS = frozenset("""a an and are as at be by for from has have if in into is it its of on or such that the
their then there these this to was were which while with we our can may also not""".split())
TOKEN = re.compile(r"[^\W_]+(?:[-'][^\W_]+)*", re.UNICODE)


def tokenize(text):
    """Lowercase word tokens; hyphenated terms stay whole and also add their parts."""
    tokens = []
    for token in TOKEN.findall(text.lower()):
        if token in STOPWORDS:
            continue
        tokens.append(token)
        if "-" in token:
            tokens.extend(part for part in token.split("-") if part and part not in STOPWORDS)
    return tokens


class BM25:
    def __init__(self, documents, k1=1.2, b=0.75):
        self.k1, self.b = k1, b
        self.docs = [Counter(tokenize(text)) for text in documents]
        self.lengths = [sum(doc.values()) for doc in self.docs]
        self.avg_length = (sum(self.lengths) / len(self.lengths)) if self.docs else 0.0
        frequency = Counter(term for doc in self.docs for term in doc)
        n = len(self.docs)
        self.idf = {term: math.log(1 + (n - df + 0.5) / (df + 0.5)) for term, df in frequency.items()}

    def scores(self, query):
        terms = [t for t in set(tokenize(query)) if t in self.idf]
        out = np.zeros(len(self.docs))
        for i, (doc, length) in enumerate(zip(self.docs, self.lengths)):
            norm = self.k1 * (1 - self.b + self.b * length / self.avg_length) if self.avg_length else self.k1
            for term in terms:
                tf = doc.get(term, 0)
                if tf:
                    out[i] += self.idf[term] * tf * (self.k1 + 1) / (tf + norm)
        return out


def ranking(scores, top_k=None):
    """Indices by descending score, ties broken by position (stable); zero scores kept last."""
    order = np.argsort(-np.asarray(scores, dtype=float), kind="stable")
    return order[:top_k].tolist() if top_k else order.tolist()


def cosine_scores(vectors, query):
    vectors, query = np.asarray(vectors, dtype=float), np.asarray(query, dtype=float)
    norms = np.linalg.norm(vectors, axis=1) * np.linalg.norm(query)
    return np.divide(vectors @ query, norms, out=np.zeros(len(vectors)), where=norms > 0)


def rrf_scored(rankings, k=60, weights=None):
    """Fuse ranked index lists; returns (index, fused score) by descending score."""
    weights = weights or [1.0] * len(rankings)
    fused = Counter()
    first_seen = {}
    for weight, ranked in zip(weights, rankings):
        for rank, index in enumerate(ranked, 1):
            fused[index] += weight / (k + rank)
            first_seen.setdefault(index, len(first_seen))
    return [(i, fused[i]) for i in sorted(fused, key=lambda i: (-fused[i], first_seen[i]))]


def rrf(rankings, k=60, weights=None, top_k=None):
    """Fuse ranked index lists; returns indices by descending fused score."""
    order = [index for index, _ in rrf_scored(rankings, k, weights)]
    return order[:top_k] if top_k else order


class HybridRetriever:
    """BM25 and dense rankings over the same items, fused with RRF.

    `vectors` are item embeddings from any encoder; `query_vector` is passed to
    `search` so the encoder stays outside (tests run without model downloads).
    """

    def __init__(self, items, vectors, depth=50, k=60):
        self.items, self.vectors, self.depth, self.k = items, np.asarray(vectors, dtype=float), depth, k
        self.bm25 = BM25([item["text"] for item in items])

    def rankings(self, query, query_vector):
        lexical = self.bm25.scores(query)
        lexical_order = [i for i in ranking(lexical, self.depth) if lexical[i] > 0]
        dense_order = ranking(cosine_scores(self.vectors, query_vector), self.depth)
        return {"bm25": lexical_order, "dense": dense_order}

    def search(self, query, query_vector, top_k=10, method="hybrid", weights=None):
        ranked = self.rankings(query, query_vector)
        order = ranked[method] if method in ranked else rrf([ranked["bm25"], ranked["dense"]], self.k, weights)
        return [self.items[i] for i in order[:top_k]]
