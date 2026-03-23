import streamlit as st
import requests
import base64

GROQ_API_KEY = st.secrets["GROQ_API_KEY"]

def parse_repo(url):
    parts = url.split("/")
    return parts[3], parts[4]

def get_repo_tree(owner, repo, headers):
    url = f"https://api.github.com/repos/{owner}/{repo}/git/trees/main?recursive=1"
    return requests.get(url, headers=headers).json()["tree"]

def get_file_content(owner, repo, path, headers):
    url = f"https://api.github.com/repos/{owner}/{repo}/contents/{path}"
    res = requests.get(url, headers=headers).json()
    return base64.b64decode(res["content"]).decode("utf-8")

def call_groq(prompt):
    res = requests.post(
        "https://api.groq.com/openai/v1/chat/completions",
        headers={
            "Authorization": f"Bearer {GROQ_API_KEY}",
            "Content-Type": "application/json"
        },
        json={
            "model": "llama-3.1-8b-instant",
            "messages": [
                {"role": "user", "content": prompt}
            ]
        }
    )
    return res.json()["choices"][0]["message"]["content"]

def create_pr(owner, repo, token, readme, review):
    headers = {"Authorization": f"token {token}"}

    # main sha
    ref = requests.get(
        f"https://api.github.com/repos/{owner}/{repo}/git/ref/heads/main",
        headers=headers
    ).json()

    sha = ref["object"]["sha"]

    # branch 생성
    requests.post(
        f"https://api.github.com/repos/{owner}/{repo}/git/refs",
        headers=headers,
        json={
            "ref": "refs/heads/ai-readme",
            "sha": sha
        }
    )

    # README commit
    requests.put(
        f"https://api.github.com/repos/{owner}/{repo}/contents/README.md",
        headers=headers,
        json={
            "message": "🤖 AI README",
            "content": base64.b64encode(readme.encode()).decode(),
            "branch": "ai-readme"
        }
    )

    # PR 생성
    pr = requests.post(
        f"https://api.github.com/repos/{owner}/{repo}/pulls",
        headers=headers,
        json={
            "title": "🤖 AI README & Review",
            "head": "ai-readme",
            "base": "main",
            "body": review
        }
    ).json()

    # 댓글
    requests.post(
        f"https://api.github.com/repos/{owner}/{repo}/issues/{pr['number']}/comments",
        headers=headers,
        json={"body": review}
    )

# UI
st.title("🤖 AI GitHub Reviewer")

repo_url = st.text_input("Repository URL")
github_token = st.text_input("GitHub Token", type="password")

if st.button("Run AI 🚀"):
    owner, repo = parse_repo(repo_url)
    headers = {"Authorization": f"token {github_token}"}

    st.write("📦 Fetching repo...")

    tree = get_repo_tree(owner, repo, headers)

    code = ""
    for file in tree:
        if file["type"] != "blob":
            continue
        if not file["path"].endswith((".js", ".py", ".ts", ".md")):
            continue

        try:
            content = get_file_content(owner, repo, file["path"], headers)
            code += f"\n\n# {file['path']}\n{content}"
        except:
            pass

    code = code[:12000]

    st.write("🧠 AI analyzing...")

    prompt = f"""
Return JSON:

{{
  "readme": "...",
  "review": "..."
}}

Code:
{code}
"""

    result = call_groq(prompt)

    import json
    data = json.loads(result)

    st.write("🚀 Creating PR...")
    create_pr(owner, repo, github_token, data["readme"], data["review"])

    st.success("✅ PR created!")
