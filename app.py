import streamlit as st
import requests
import base64
import json
import re

# -----------------------------
# 🔐 API KEY
# -----------------------------
GROQ_API_KEY = st.secrets["GROQ_API_KEY"]

# -----------------------------
# 🔧 유틸 함수
# -----------------------------
def parse_repo(url):
    parts = url.strip().split("/")
    return parts[3], parts[4]

def get_repo_tree(owner, repo, headers):
    url = f"https://api.github.com/repos/{owner}/{repo}/git/trees/main?recursive=1"
    res = requests.get(url, headers=headers)
    return res.json().get("tree", [])

def get_file_content(owner, repo, path, headers):
    url = f"https://api.github.com/repos/{owner}/{repo}/contents/{path}"
    res = requests.get(url, headers=headers).json()
    if "content" not in res:
        return ""
    return base64.b64decode(res["content"]).decode("utf-8", errors="ignore")

# -----------------------------
# 🤖 GROQ 호출
# -----------------------------
def call_groq(prompt):
    res = requests.post(
        "https://api.groq.com/openai/v1/chat/completions",
        headers={
            "Authorization": f"Bearer {GROQ_API_KEY}",
            "Content-Type": "application/json"
        },
        json={
            "model": "llama-3.1-8b-instant",
            "temperature": 0,
            "messages": [
                {
                    "role": "system",
                    "content": "You are a strict JSON generator. Only output valid JSON."
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ]
        }
    )
    return res.json()["choices"][0]["message"]["content"]

# -----------------------------
# 🧠 JSON 안전 파싱
# -----------------------------
def parse_sections(text):
    try:
        readme = text.split("===README===")[1].split("===REVIEW===")[0].strip()
        review = text.split("===REVIEW===")[1].strip()
        return {
            "readme": readme,
            "review": review
        }
    except:
        raise Exception("Parsing failed")

# -----------------------------
# 🚀 PR 생성
# -----------------------------
def create_pr(owner, repo, token, readme, review):
    headers = {"Authorization": f"token {token}"}

    # main branch SHA 가져오기
    ref = requests.get(
        f"https://api.github.com/repos/{owner}/{repo}/git/ref/heads/main",
        headers=headers
    ).json()

    sha = ref["object"]["sha"]

    # 브랜치 생성
    requests.post(
        f"https://api.github.com/repos/{owner}/{repo}/git/refs",
        headers=headers,
        json={
            "ref": "refs/heads/ai-readme",
            "sha": sha
        }
    )

    # README 커밋
    requests.put(
        f"https://api.github.com/repos/{owner}/{repo}/contents/README.md",
        headers=headers,
        json={
            "message": "🤖 AI Generated README",
            "content": base64.b64encode(readme.encode()).decode(),
            "branch": "ai-readme"
        }
    )

    # PR 생성
    pr = requests.post(
        f"https://api.github.com/repos/{owner}/{repo}/pulls",
        headers=headers,
        json={
            "title": "🤖 AI README & Code Review",
            "head": "ai-readme",
            "base": "main",
            "body": review
        }
    ).json()

    # PR 댓글
    requests.post(
        f"https://api.github.com/repos/{owner}/{repo}/issues/{pr['number']}/comments",
        headers=headers,
        json={"body": review}
    )

# -----------------------------
# 🌐 UI
# -----------------------------
st.title("🤖 Zerro AI GitHub Analyzer")

repo_url = st.text_input("📦 Repository URL")
github_token = st.text_input("🔑 GitHub Token", type="password")

if st.button("🚀 Run AI"):
    try:
        owner, repo = parse_repo(repo_url)
        headers = {"Authorization": f"token {github_token}"}

        st.write("📦 Fetching repository...")

        tree = get_repo_tree(owner, repo, headers)

        code = ""
        for file in tree:
            if file["type"] != "blob":
                continue

            if not file["path"].endswith((".js", ".py", ".ts", ".md")):
                continue

            try:
                content = get_file_content(owner, repo, file["path"], headers)
                code += f"\n\n# FILE: {file['path']}\n{content}"
            except:
                pass

        code = code[:12000]

        st.write("🧠 AI analyzing...")

        prompt = f"""
Return in this EXACT format:

===README===
<full readme content>

===REVIEW===
<code review>

NO JSON.
NO explanation.

Code:
{code}
"""

        result = call_groq(prompt)

        st.write("📄 RAW OUTPUT (debug)")
        st.code(result)

        data = parse_sections(result)

        st.write("🚀 Creating PR...")

        create_pr(owner, repo, github_token, data["readme"], data["review"])

        st.success("✅ PR Created Successfully!")

    except Exception as e:
        st.error(f"❌ Error: {str(e)}")
