def build_prompt(question: str, chunks: list, mode: str = "qa"):
    context = ""
    if chunks:
        context = "\n\n".join(
            f"[{i+1}] {c.get('text', '')}"
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
    return f"""You are a helpful document assistant. Answer questions based ONLY on the provided context.

RULES:
1. Only use information from the context below.
2. If the answer is not in the context, say "I couldn't find that information in the document."
3. Include citation numbers like [1], [2] after statements to reference which context chunk you used.
4. Be concise but thorough.

CONTEXT:
{context}

QUESTION: {question}

ANSWER:"""
