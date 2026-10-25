def source_label(chunk: dict) -> str:
    """Where a context item came from, so the model can tell a definition from a passage."""
    page = f"page {chunk['page']}" if chunk.get("page") else "unknown page"
    if chunk.get("kind") != "concept":
        return f"({page})"
    checked = ", verified by the reader" if chunk.get("verified") else ""
    return f"({chunk.get('type') or 'Concept'} \"{chunk.get('title', '')}\", {page}{checked})"


def build_prompt(question: str, chunks: list, mode: str = "qa"):
    context = ""
    if chunks:
        context = "\n\n".join(
            f"[{i+1}] {source_label(c)} {c.get('text', '')}"
            for i, c in enumerate(chunks)
        )

    if mode == "explain":
        return f"""
You are an expert tutor.
Explain the following text as if you are teaching it.
Use simple language and analogies where appropriate.

TEXT TO EXPLAIN:
{question} 

(Note: In 'explain' mode, the user selected text is passed as the question)
"""

    if mode == "summary":
        return f"""
You are a professional summarizer.
Create a concise summary of the provided text.
Capture the main points, key arguments, and conclusions.

TEXT CONTEXT:
{context}

Format:
- Bullet points for key takeaways
- A short paragraph inference
"""

    # Default QA
    if not context.strip():
        return f"""Answer the question from your general knowledge.

RULES:
1. Start with "General knowledge (not from the PDF):".
2. Be direct and specific. For "explain" questions, explain step by step.
3. No greetings, and do not ask the user questions back.
4. If you do not know, say so plainly instead of guessing.

QUESTION: {question}

ANSWER:"""

    return f"""Answer the question using the numbered excerpts from the PDF below.

RULES:
1. Use the excerpts first. Put a citation like [1] or [2] after each statement taken from them.
2. Keep formulas, symbols, conditions and units exactly as the excerpts give them.
3. If the excerpts do not answer the question, say "The PDF does not cover this." Then, if you know the answer, add a short part starting with "General knowledge:" and no citations.
4. Write the answer itself, not a description of each excerpt. Never start a sentence with "[1] explains" or similar.
5. Be direct and specific. For "explain" questions, explain step by step.
6. Write maths in LaTeX between \\( and \\) inline, or \\[ and \\] on its own line.
7. No greetings, and do not ask the user questions back.

EXCERPTS FROM THE PDF:
{context}

QUESTION: {question}

ANSWER:"""
