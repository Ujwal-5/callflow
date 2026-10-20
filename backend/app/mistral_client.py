"""Small synchronous Mistral client used by the post-call analyzers."""

from typing import Any

from backend.app.config import settings


def _content_to_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                if isinstance(item.get("text"), str):
                    parts.append(item["text"])
            elif isinstance(getattr(item, "text", None), str):
                parts.append(item.text)
        return "".join(parts)
    if isinstance(content, dict):
        return str(content.get("text", ""))
    return ""


def _response_text(response: Any) -> str:
    """Support both beta conversation responses and chat-style responses."""
    outputs = getattr(response, "outputs", None)
    if outputs:
        output = outputs[0]
        content = output.get("content") if isinstance(output, dict) else getattr(output, "content", None)
        text = _content_to_text(content)
        if text:
            return text.strip()

    choices = getattr(response, "choices", None)
    if choices:
        message = getattr(choices[0], "message", None)
        content = message.get("content") if isinstance(message, dict) else getattr(message, "content", None)
        text = _content_to_text(content)
        if text:
            return text.strip()

    return _content_to_text(getattr(response, "content", None)).strip()


def generate_json(
    prompt: str,
    instructions: str = "",
    temperature: float = 0.1,
) -> str:
    """Generate a JSON response with Mistral's beta conversations API."""
    if not settings.mistral_configured:
        raise RuntimeError("MISTRAL_API_KEY is not configured on the server.")

    from mistralai.client import Mistral

    client = Mistral(api_key=settings.MISTRAL_API_KEY)
    response = client.beta.conversations.start(
        inputs=[{"role": "user", "content": prompt}],
        model=settings.MISTRAL_MODEL,
        instructions=instructions,
        completion_args={
            "temperature": temperature,
            "max_tokens": 2048,
            "top_p": 1,
        },
        tools=[],
    )
    text = _response_text(response)
    if not text:
        raise ValueError("Mistral returned an empty response.")
    return text
