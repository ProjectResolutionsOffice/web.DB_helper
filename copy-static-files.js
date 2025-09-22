const fs = require('fs');
const path = require('path');

const filesToCopy = [
  'robots.txt',
  'ads.txt',
  'googleef03e757e46e8c03.html',
  'erd_icon.png',
  //'webicon.svg',
  // 여기에 복사하고 싶은 다른 파일이 있다면 추가하세요.
  // 'metadata.json', 
];

const distDir = path.join(__dirname, 'dist');

// dist 디렉토리가 없으면 생성
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir);
}

filesToCopy.forEach(file => {
  const sourcePath = path.join(__dirname, file);
  const destPath = path.join(distDir, file);

  if (fs.existsSync(sourcePath)) {
    fs.copyFileSync(sourcePath, destPath);
    console.log(`Copied ${file} to dist/`);
  } else {
    console.warn(`Warning: Source file not found - ${sourcePath}`);
  }
});