import os
import sys

try:
    from huggingface_hub import hf_hub_download
except ImportError:
    print("Error: 'huggingface_hub' is required. Run: pip install huggingface_hub")
    sys.exit(1)

MODEL_REPO = "bartowski/Meta-Llama-3.1-8B-Instruct-GGUF"
MODEL_FILENAME = "Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf"
# Relative to this script (scripts/ folder) -> ../models
TARGET_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models")

def download_model():
    print(f"Target Directory: {TARGET_DIR}")
    if not os.path.exists(TARGET_DIR):
        os.makedirs(TARGET_DIR)
    
    print(f"Downloading {MODEL_FILENAME} from {MODEL_REPO}...")
    try:
        path = hf_hub_download(
            repo_id=MODEL_REPO,
            filename=MODEL_FILENAME,
            local_dir=TARGET_DIR,
            local_dir_use_symlinks=False
        )
        print(f"✅ Model downloaded successfully to: {path}")
    except Exception as e:
        print(f"❌ Download failed: {e}")

if __name__ == "__main__":
    download_model()
