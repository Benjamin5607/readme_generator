require("dotenv").config();
const axios = require("axios");
const fs = require("fs");

const GROQ_API_KEY = process.env.GROQ_API_KEY;

// 🔥 GitHub 전체 파일 트리 가져오기
async function getRepoTree(owner, repo) {
  const res = await axios.get(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/main?recursive=1`
  );
  return res.data.tree;
}

// 🔥 중요한 파일 필터링
function pickImportantFiles(tree) {
  return tree
    .filter(file =>
      file.path.endsWith(".js") ||
      file.path.endsWith(".ts") ||
      file.path.endsWith(".json")
    )
    .filter(file =>
      file.path.includes("src") ||
      file.path.includes("index") ||
      file.path.includes("main") ||
      file.path.includes("app") ||
      file.path.includes("package.json")
    )
    .slice(0, 8); // 토큰 제한
}

// 🔥 파일 내용 가져오기
async function fetchFile(owner, repo, path) {
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/main/${path}`;
  try {
    const res = await axios.get(url);
    return `FILE: ${path}\n${res.data.substring(0, 2000)}`;
  } catch {
    return "";
  }
}

// 🔥 Groq 호출
async function callGroq(code) {
  const res = await axios.post(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      model: "mixtral-8x7b-32768",
      messages: [
        {
          role: "system",
          content: "You are a senior software architect and reviewer."
        },
        {
          role: "user",
          content: `
Analyze this repository and return JSON:

{
  "readme": "Full README.md content",
  "review": "Code review summary",
  "improvements": ["item1", "item2"]
}

Code:
${code}
          `
        }
      ]
    },
    {
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json"
      }
    }
  );

  return res.data.choices[0].message.content;
}

// 🔥 메인 실행
async function analyze(repoUrl) {
  const [_, owner, repo] = repoUrl.split("/").slice(-3);

  console.log("📦 Fetching repo tree...");
  const tree = await getRepoTree(owner, repo);

  const importantFiles = pickImportantFiles(tree);

  console.log("📄 Fetching files...");
  const contents = await Promise.all(
    importantFiles.map(f => fetchFile(owner, repo, f.path))
  );

  console.log("🧠 Running AI analysis...");
  const resultText = await callGroq(contents.join("\n\n"));

  let result;
  try {
    result = JSON.parse(resultText);
  } catch (e) {
    console.log("❌ JSON parse failed. Raw output:\n", resultText);
    return;
  }

  console.log("\n📘 README Generated:\n");
  console.log(result.readme);

  fs.writeFileSync("README.md", result.readme);

  console.log("\n🔍 Review:\n", result.review);
  console.log("\n⚡ Improvements:\n", result.improvements);
}

// 👉 실행
const repoUrl = process.argv[2];

if (!repoUrl) {
  console.log("❌ Usage: node analyze.js https://github.com/user/repo");
  process.exit(1);
}

analyze(repoUrl);
