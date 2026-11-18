import React from 'react';
import ReactDOM from 'react-dom/client';
import Galaxy from './components/Galaxy';

function GalaxyHero() {
  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Galaxy
        density={0.75}
        layers={4}
        glowIntensity={0.25}
        flareIntensity={0.8}
        starSpeed={0.35}
        mouseRepulsion
        clickWarp
        dpr={0.75}
      />
    </div>
  );
}

const mountEl = document.getElementById('galaxy-root');
if (mountEl) {
  const root = ReactDOM.createRoot(mountEl);
  root.render(<GalaxyHero />);
}
