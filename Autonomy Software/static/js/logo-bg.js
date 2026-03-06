

// Dynamic, less frequent, random logo background
const bg = document.createElement('div');
bg.style.position = 'fixed';
bg.style.top = '0';
bg.style.left = '0';
bg.style.width = '100vw';
bg.style.height = '100vh';
bg.style.zIndex = '0';
bg.style.pointerEvents = 'none';
bg.style.overflow = 'hidden';
bg.style.opacity = '1';
document.body.prepend(bg);

// Reduce number of logos for performance and use CSS animations
const NUM_LOGOS = 6;
for (let i = 0; i < NUM_LOGOS; i++) {
  const img = document.createElement('img');
  img.src = 'icon (2).png';
  const size = 48 + Math.random() * 80; // smaller, reasonable sizes
  img.style.width = size + 'px';
  img.style.height = size + 'px';
  img.style.position = 'absolute';
  img.style.left = (5 + Math.random() * 90) + 'vw';
  img.style.top = (5 + Math.random() * 85) + 'vh';
  img.style.opacity = '0.95';
  img.style.userSelect = 'none';
  img.draggable = false;
  img.className = 'floating-logo';
  // randomize animation duration/offset for variety
  const dur = 8 + Math.random() * 10;
  img.style.animation = `floatY ${dur}s ease-in-out ${Math.random()*-dur}s infinite alternate, spin ${12 + Math.random()*20}s linear infinite`;
  img.style.filter = 'drop-shadow(0 0 12px #ffe06688)';
  bg.appendChild(img);
}
