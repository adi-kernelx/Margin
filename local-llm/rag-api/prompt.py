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

    # Default QA - improved to handle general questions and chitchat
    if not context.strip():
        # No context available - handle general questions
        return f"""You are a friendly and helpful AI assistant. The user asked: "{question}"

The user is viewing a PDF document but hasn't asked about its specific content, or you couldn't find relevant information in the document.

RULES:
1. If this is a greeting (like "hi", "hello", "hey"), respond warmly and offer to help with questions about the document.
2. If this is a general knowledge question NOT about the document, you may answer it briefly but remind the user that your main purpose is to help with the PDF content.
3. If the user asks "who are you" or similar questions, explain that you are an AI assistant that helps users understand and search through PDF documents.
4. Be conversational and friendly.
5. If the question seems to be about the document but you found no relevant chunks, politely say you couldn't find that information in the current document.

ANSWER:"""
    
    return f"""You are a helpful document assistant. Answer questions based on the provided context from the PDF document.

RULES:
1. Prioritize using information from the context below.
2. If the answer is clearly in the context, use it and cite with [1], [2] etc.
3. If the question is a greeting or chitchat (like "hi", "hello"), respond warmly and briefly.
4. If the question is a general knowledge question NOT related to the document content, you may answer briefly but mention you can also help with the document.
5. If the question appears to be about the document but the answer is NOT in the context, say "I couldn't find that specific information in the document."
6. Be concise but thorough.
7. Include citation numbers like [1], [2] after statements when referencing context chunks.

CONTEXT FROM DOCUMENT:
{context}

USER QUESTION: {question}

ANSWER:"""
