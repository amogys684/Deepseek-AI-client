from flask import Flask, render_template, request, jsonify, Response
import json, os, requests

app = Flask(__name__)
PROVIDERS_FILE = "providers.json"

DEFAULT_PROVIDERS = {
    "openai": {
        "name": "OpenAI", "base_url": "https://api.openai.com/v1", "api_key": "",
        "models": ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo", "o1-mini", "o3-mini"]
    },
    "anthropic": {
        "name": "Anthropic", "base_url": "https://api.anthropic.com/v1", "api_key": "",
        "models": ["claude-3-5-sonnet-20241022", "claude-3-haiku-20240307"]
    },
    "deepseek": {
        "name": "DeepSeek", "base_url": "https://api.deepseek.com/v1", "api_key": "",
        "models": ["deepseek-chat", "deepseek-reasoner"]
    },
    "groq": {
        "name": "Groq", "base_url": "https://api.groq.com/openai/v1", "api_key": "",
        "models": ["llama-3.3-70b-versatile", "deepseek-r1-distill-llama-70b", "qwq-32b"]
    },
    "mistral": {
        "name": "Mistral", "base_url": "https://api.mistral.ai/v1", "api_key": "",
        "models": ["mistral-large-latest", "mistral-small-latest"]
    },
    "openrouter": {
        "name": "OpenRouter", "base_url": "https://openrouter.ai/api/v1", "api_key": "",
        "models": ["openai/gpt-4o", "anthropic/claude-3.5-sonnet", "deepseek/deepseek-r1"]
    },
}

def load_providers():
    if not os.path.exists(PROVIDERS_FILE):
        save_providers(DEFAULT_PROVIDERS)
        return DEFAULT_PROVIDERS
    with open(PROVIDERS_FILE, encoding="utf-8") as f:
        return json.load(f)

def save_providers(p):
    with open(PROVIDERS_FILE, "w", encoding="utf-8") as f:
        json.dump(p, f, indent=2, ensure_ascii=False)

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/providers", methods=["GET"])
def get_providers():
    return jsonify(load_providers())

@app.route("/api/providers", methods=["POST"])
def add_provider():
    data = request.json
    pid = (data.get("id") or "").strip().lower().replace(" ", "_")
    if not pid or not data.get("base_url"):
        return jsonify({"error": "Нужны id и base_url"}), 400
    providers = load_providers()
    if pid in providers:
        return jsonify({"error": "Провайдер с таким ID уже существует"}), 400
    providers[pid] = {
        "name": data.get("name") or pid,
        "base_url": data["base_url"].rstrip("/"),
        "api_key": data.get("api_key", ""),
        "models": data.get("models", []),
    }
    save_providers(providers)
    return jsonify({"ok": True, "id": pid})

@app.route("/api/providers/<pid>", methods=["PUT"])
def update_provider(pid):
    data = request.json
    providers = load_providers()
    if pid not in providers:
        return jsonify({"error": "Провайдер не найден"}), 404
    p = providers[pid]
    if "name" in data: p["name"] = data["name"]
    if "base_url" in data: p["base_url"] = data["base_url"].rstrip("/")
    if "api_key" in data: p["api_key"] = data["api_key"]
    if "models" in data: p["models"] = data["models"]
    save_providers(providers)
    return jsonify({"ok": True})

@app.route("/api/providers/<pid>", methods=["DELETE"])
def del_provider(pid):
    providers = load_providers()
    providers.pop(pid, None)
    save_providers(providers)
    return jsonify({"ok": True})

@app.route("/api/test", methods=["POST"])
def test_connection():
    data = request.json
    url = (data.get("base_url") or "").rstrip("/")
    key = data.get("api_key") or ""
    if not url:
        return jsonify({"error": "Нужен base_url"}), 400
    try:
        r = requests.get(
            url + "/models",
            headers={"Authorization": f"Bearer {key}"},
            timeout=10,
        )
        if r.status_code == 200:
            count = len(r.json().get("data", []))
            return jsonify({"ok": True, "models_count": count})
        return jsonify({"error": f"HTTP {r.status_code}"}), 502
    except Exception as e:
        return jsonify({"error": str(e)}), 502

@app.route("/api/models", methods=["POST"])
def list_models():
    data = request.json
    providers = load_providers()
    p = providers.get(data.get("provider"))
    if not p:
        return jsonify({"error": "Провайдер не найден"}), 400
    try:
        r = requests.get(
            p["base_url"] + "/models",
            headers={"Authorization": f"Bearer {p['api_key']}"},
            timeout=15,
        )
        if r.status_code != 200:
            return jsonify({"error": f"HTTP {r.status_code}: {r.text[:200]}"}), 502
        raw = r.json().get("data", [])
        models = sorted({m.get("id") for m in raw if m.get("id")})
        return jsonify({"models": models})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/chat", methods=["POST"])
def chat():
    data = request.json
    providers = load_providers()
    p = providers.get(data.get("provider"))
    if not p:
        return jsonify({"error": "Провайдер не найден"}), 400
    if not p.get("api_key"):
        return jsonify({"error": "Не задан API ключ — настройте провайдера (⚙)"}), 400

    payload = {
        "model": data["model"],
        "messages": data["messages"],
        "stream": True,
        "temperature": data.get("temperature", 0.7),
    }

    def generate():
        try:
            r = requests.post(
                p["base_url"] + "/chat/completions",
                headers={
                    "Authorization": f"Bearer {p['api_key']}",
                    "Content-Type": "application/json",
                },
                json=payload, stream=True, timeout=180,
            )
            if r.status_code != 200:
                yield f'data: {json.dumps({"error": r.text})}\n\n'
                return
            for line in r.iter_lines(decode_unicode=True):
                if line:
                    yield line + "\n\n"
        except Exception as e:
            yield f'data: {json.dumps({"error": str(e)})}\n\n'

    return Response(generate(), mimetype="text/event-stream",
                    headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"})

if __name__ == "__main__":
    app.run(debug=True, port=5000)