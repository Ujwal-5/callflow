"""Standalone test script for Gemini API integration in CallFlow.

Tests loading environment variables from backend/.env, initializing the Gemini client,
and requesting a two-sentence summary and concrete next action for a fictional cold-call conversation.
"""

import sys
from pathlib import Path

# Add project root to sys.path if not present so imports like `backend.app.config` work
BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

try:
    from google import genai
    from google.genai import errors as genai_errors
    from google.genai import types
except ImportError as e:
    print(f"FAIL: Google GenAI SDK is not installed or importable: {e}")
    sys.exit(1)

from backend.app.config import settings


def run_gemini_test() -> bool:
    print("=" * 60)
    print("CallFlow Gemini API Integration Test")
    print("=" * 60)

    # 1. Check API Key presence
    api_key = settings.GEMINI_API_KEY
    if not api_key or not api_key.strip():
        print("FAIL: GEMINI_API_KEY is missing or empty in environment / backend/.env file.")
        return False
    print("✓ Environment variable GEMINI_API_KEY detected and loaded.")

    # 2. Initialize Gemini Client reusing settings
    try:
        client = genai.Client(api_key=api_key)
    except Exception as e:
        print(f"FAIL: Failed to initialize Gemini client: {e}")
        return False

    # 3. Define model and test prompt
    model_name = "gemini-3.8-flash"
    test_prompt = (
        "Summarize the following fictional B2B cold call in exactly two sentences, "
        "and extract one concrete next action:\n\n"
        "Prospect: 'Hi, yes, this is Sarah from Acme Logistics. We are currently using spreadsheets "
        "to track shipments, which is causing frequent delays. We might be interested in your "
        "automated tracking dashboard, but I am in back-to-back meetings today. Send me an overview deck "
        "and call me on Thursday at 2 PM to walk through pricing.'\n"
        "Rep: 'Understood, Sarah. I will send over our product deck immediately and follow up this Thursday at 2 PM.'"
    )

    print(f"✓ Using model: {model_name}")
    print("Sending test request to Gemini...")

    # 4. Execute request with error handling
    try:
        response = client.models.generate_content(
            model=model_name,
            contents=test_prompt,
            config=types.GenerateContentConfig(
                temperature=0.2,
                max_output_tokens=1000,
            ),
        )

        output_text = response.text.strip() if response.text else ""
        if not output_text:
            print("FAIL: Received empty response text from Gemini model.")
            return False

        print("\n--- Model Response ---")
        print(output_text)
        print("----------------------\n")
        print("RESULT: PASS - Gemini API call succeeded and returned a valid response.")
        return True

    except genai_errors.APIError as e:
        code = getattr(e, "code", None)
        message = getattr(e, "message", str(e))
        if code == 400 or "API_KEY_INVALID" in str(e) or "API key not valid" in str(e):
            print(f"FAIL: Authentication error (invalid API key): {message}")
        elif code == 403 or "PERMISSION_DENIED" in str(e):
            print(f"FAIL: Permission denied / Auth error: {message}")
        elif code == 404 or "NOT_FOUND" in str(e) or "models/" in str(e):
            print(f"FAIL: Unsupported model error ({model_name}): {message}")
        elif code == 429 or "RESOURCE_EXHAUSTED" in str(e):
            print(f"FAIL: Quota / Rate limit error: {message}")
        else:
            print(f"FAIL: Gemini API error [{code}]: {message}")
        return False

    except (ConnectionError, TimeoutError) as e:
        print(f"FAIL: Network error while communicating with Gemini API: {e}")
        return False

    except Exception as e:
        err_msg = str(e)
        if "quota" in err_msg.lower() or "429" in err_msg:
            print(f"FAIL: Quota error: {err_msg}")
        elif "auth" in err_msg.lower() or "api key" in err_msg.lower() or "401" in err_msg or "403" in err_msg:
            print(f"FAIL: Authentication error: {err_msg}")
        elif "model" in err_msg.lower() and "found" in err_msg.lower():
            print(f"FAIL: Unsupported model error: {err_msg}")
        else:
            print(f"FAIL: Unexpected error during Gemini test: {err_msg}")
        return False


if __name__ == "__main__":
    success = run_gemini_test()
    sys.exit(0 if success else 1)
