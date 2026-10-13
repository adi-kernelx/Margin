# Block annotation guide

You are labelling text blocks extracted from PDFs (maths textbooks, research
papers, lecture slides, standards). Each block is one paragraph-like unit of
text. PDF extraction is imperfect: maths may be garbled, symbols may be spaced
out, and a block may contain the end of one item and the start of the next.
Label what the block **is**, as a reader of the original document would.

Give every block **two** answers.

## 1. `label`: the block's main role (exactly one)

| Label | Use when the block … |
|---|---|
| `definition` | introduces the meaning of a named concept, including prose such as "is called", "we say", "is defined as"; security games and named assumptions count |
| `theorem` | states a result: theorem, lemma, proposition, corollary, claim or conjecture (including a fragment of such a statement) |
| `proof` | argues for a result (including a fragment of a proof, a proof sketch, or a derivation step inside a proof) |
| `example` | is a worked example, exercise, problem statement, exercise solution or slide question |
| `notation` | introduces symbols or conventions without primarily defining a concept ("we write ‖·‖ for the Euclidean norm") |
| `algorithm` | is a procedure or a sequence of computational steps, including pseudocode and code |
| `other` | anything else: discussion, motivation, background, references, captions, headings, front matter, remarks, notes, tables, assumptions |

Rules for hard cases:

1. **Mixed blocks:** choose the role that takes up most of the block, with one
   exception: if a definition takes up roughly a third of the block or more,
   choose `definition`.
2. **Fragments** take the role of what they continue: the tail of a theorem
   statement is `theorem`; the middle of a proof is `proof`.
3. A heading on its own ("3.1 Bilinear maps") is `other`.
4. A reference list or a single citation is `other`.
5. An exercise that happens to define a term is `example`, unless the definition
   is most of the block.

## 2. `contains_definition`: true or false

`true` if **any** sentence in the block states what a named term or a symbol
means. This is independent of `label`: a proof can contain a definition.

Counts as true:

- "A graph is called *bipartite* if its vertices split into two classes."
- "We refer to this quantity as the *margin*."
- "Let N(v) denote the set of neighbours of v." (local notation counts)
- "Define g(x) := x² + 1."
- "Round-Trip Time (RTT): the time for a packet to go to the server and back." (slide gloss)

Counts as false:

- references to definitions elsewhere: "by Definition 2", "as defined in Section 3", "by the definition of A";
- "define" in its ordinary sense: "these principles define the architecture";
- announcements without the content: "In this section we define the cone and prove …";
- statements of results or hypotheses inside a theorem;
- exercise solutions that give a formula as an answer.

If `label` is `definition` or `notation`, `contains_definition` must be `true`.

## Output format

One JSON object per line, one line per block, in the order given, nothing else:

```json
{"block_id": "36bc35f8d3d19bba", "label": "notation", "contains_definition": true}
```

Use the `block_id` exactly as given. Do not skip blocks; if a block is
unreadable, give your best guess and still output a line.
