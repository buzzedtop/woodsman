<script lang="ts">
  import { onMount } from 'svelte';
  import { io, Socket } from 'socket.io-client';
  import { LocalGameEngine } from '$lib/LocalGameEngine';

  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D;
  let socket: Socket;

  // Game state
  let state = {
    players: {},
    entities: {}
  };
  let ageUpCost = { wood: 10, stone: 5, iron: 2 };
  let myId: string | null = null;
  let baseZoneRadius = 500;

  // Input state
  const keys = {
    w: false,
    a: false,
    s: false,
    d: false
  };

  // Camera state
  let camera = { x: 0, y: 0 };

  // Viewport dimensions
  let width = 0;
  let height = 0;

  let isOffline = false;
  let localEngine: LocalGameEngine | null = null;
  let connecting = true;

  function initLocalEngine() {
    isOffline = true;
    connecting = false;
    localEngine = new LocalGameEngine();

    localEngine.onInit = (data) => {
      myId = data.id;
      state.players = data.players;
      state.entities = data.entities;
      baseZoneRadius = data.baseZoneRadius;
      console.log('Local Engine Initialized with ID:', myId);
    };

    localEngine.onAgeUpSuccess = (data) => {
      ageUpCost = data.newCost;
    };

    localEngine.onStateUpdate = (data) => {
      state.players = data.players;
      state.entities = data.entities;
    };

    localEngine.start();
  }

  function connectSocket() {
    connecting = true;
    isOffline = false;
    if (localEngine) {
      localEngine.stop();
      localEngine = null;
    }

    const backendUrl = import.meta.env.DEV ? 'http://localhost:3000' : '/';
    if (socket) {
      socket.disconnect();
    }

    socket = io(backendUrl, {
      timeout: 5000,
      reconnectionAttempts: 2
    });

    socket.on('connect', () => {
      connecting = false;
      isOffline = false;
      console.log('Connected to backend');
    });

    socket.on('connect_error', () => {
      console.log('Connection failed, falling back to offline mode');
      if (!isOffline) {
        initLocalEngine();
      }
    });

    socket.on('init', (data) => {
      myId = data.id;
      state.players = data.players;
      state.entities = data.entities;
      baseZoneRadius = data.baseZoneRadius;
      console.log('Initialized with ID:', myId);
    });

    socket.on('ageUpSuccess', (data) => {
      ageUpCost = data.newCost;
    });

    socket.on('stateUpdate', (data) => {
      state.players = data.players;
      state.entities = data.entities;
    });
  }

  function resetLocalState() {
    if (localEngine) {
      localEngine.reset();
    }
  }

  const sendInput = () => {
    let dx = 0;
    let dy = 0;
    if (keys.w) dy -= 1;
    if (keys.s) dy += 1;
    if (keys.a) dx -= 1;
    if (keys.d) dx += 1;

    if (isOffline && localEngine) {
      localEngine.input({ dx, dy });
    } else if (socket) {
      socket.emit('input', { dx, dy });
    }
  };

  const performAction = (actionType: string) => {
    if (actionType === 'interact') {
      if (isOffline && localEngine) localEngine.interact();
      else socket?.emit('interact');
    } else if (actionType === 'ageUp') {
      if (isOffline && localEngine) localEngine.ageUp();
      else socket?.emit('ageUp');
    } else if (actionType === 'build') {
      if (isOffline && localEngine) localEngine.build({ type: 'turret' });
      else socket?.emit('build', { type: 'turret' });
    }
  };

  const handleMobileDir = (dir: 'w'|'a'|'s'|'d', state: boolean, e: Event) => {
    e.preventDefault(); // Prevent double firing from touch + mouse
    keys[dir] = state;
    sendInput();
  };

  onMount(() => {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;
    ctx = canvas.getContext('2d')!;

    // Resize handler
    const onResize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width;
      canvas.height = height;
    };
    window.addEventListener('resize', onResize);

    // Input handling
    const onKeyDown = (e: KeyboardEvent) => {
      if (keys.hasOwnProperty(e.key.toLowerCase())) {
        keys[e.key.toLowerCase() as keyof typeof keys] = true;
        sendInput();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (keys.hasOwnProperty(e.key.toLowerCase())) {
        keys[e.key.toLowerCase() as keyof typeof keys] = false;
        sendInput();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    const onKeyPress = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'e') {
        performAction('interact');
      } else if (e.key.toLowerCase() === 'q') {
        performAction('ageUp');
      } else if (e.key.toLowerCase() === 'b') {
        performAction('build');
      }
    };

    window.addEventListener('keypress', onKeyPress);

    // Render loop
    let animationFrameId: number;
    const render = () => {
      ctx.clearRect(0, 0, width, height);

      const me = myId ? state.players[myId] : null;
      if (me) {
        // Simple smooth camera follow
        camera.x += (me.x - camera.x) * 0.1;
        camera.y += (me.y - camera.y) * 0.1;
      }

      ctx.save();
      // Translate to camera center
      ctx.translate(width / 2 - camera.x, height / 2 - camera.y);

      // Draw grid/background for visual reference
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 1;
      const gridSize = 100;
      const startX = Math.floor((camera.x - width/2) / gridSize) * gridSize;
      const startY = Math.floor((camera.y - height/2) / gridSize) * gridSize;

      ctx.beginPath();
      for (let x = startX; x < camera.x + width/2; x += gridSize) {
        ctx.moveTo(x, camera.y - height/2);
        ctx.lineTo(x, camera.y + height/2);
      }
      for (let y = startY; y < camera.y + height/2; y += gridSize) {
        ctx.moveTo(camera.x - width/2, y);
        ctx.lineTo(camera.x + width/2, y);
      }
      ctx.stroke();

      // Draw Center mark
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(0, 0, 5, 0, Math.PI * 2);
      ctx.fill();

      // Draw Zones (Visible up to a few levels ahead for context)
      const maxAgeToDraw = (me ? me.age : 0) + 3;
      for (let i = 0; i <= maxAgeToDraw; i++) {
        ctx.beginPath();
        ctx.arc(0, 0, baseZoneRadius * (i + 1), 0, Math.PI * 2);
        ctx.strokeStyle = i === 0 ? '#4CAF50' : '#888'; // Zone 0 boundary is green
        ctx.setLineDash([10, 15]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Label
        ctx.fillStyle = '#888';
        ctx.font = '20px sans-serif';
        ctx.fillText(`Zone ${i}`, 10, -baseZoneRadius * (i + 1) + 20);
      }

      // Draw restricted area indicator (red shaded circle)
      if (me && me.age > 0) {
        ctx.beginPath();
        ctx.arc(0, 0, baseZoneRadius * me.age, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 0, 0, 0.1)';
        ctx.fill();
        ctx.strokeStyle = 'red';
        ctx.stroke();
      }

      // Draw Entities (Resources, etc.)
      for (const id in state.entities) {
        const ent = state.entities[id];
        ctx.beginPath();
        if (ent.type === 'resource') {
          ctx.arc(ent.x, ent.y, ent.radius, 0, Math.PI * 2);
          if (ent.resourceType === 'wood') ctx.fillStyle = '#8B4513';
          else if (ent.resourceType === 'stone') ctx.fillStyle = '#808080';
          else if (ent.resourceType === 'iron') ctx.fillStyle = '#B0C4DE';
          ctx.fill();
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 1;
          ctx.stroke();
        } else if (ent.type === 'building') {
          ctx.fillStyle = ent.abandoned ? '#555' : '#4CAF50';
          ctx.fillRect(ent.x - ent.radius, ent.y - ent.radius, ent.radius * 2, ent.radius * 2);
          ctx.strokeStyle = '#fff';
          ctx.strokeRect(ent.x - ent.radius, ent.y - ent.radius, ent.radius * 2, ent.radius * 2);

          // Draw HP bar
          ctx.fillStyle = 'red';
          ctx.fillRect(ent.x - ent.radius, ent.y - ent.radius - 10, ent.radius * 2, 5);
          ctx.fillStyle = 'green';
          ctx.fillRect(ent.x - ent.radius, ent.y - ent.radius - 10, (ent.hp / ent.maxHp) * (ent.radius * 2), 5);
        } else if (ent.type === 'zombie') {
          ctx.beginPath();
          ctx.arc(ent.x, ent.y, ent.radius, 0, Math.PI * 2);
          ctx.fillStyle = '#ff5555';
          ctx.fill();
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 1;
          ctx.stroke();

          // Zombie Face / Indicator
          ctx.fillStyle = '#000';
          ctx.beginPath();
          ctx.arc(ent.x - 4, ent.y - 2, 2, 0, Math.PI*2);
          ctx.arc(ent.x + 4, ent.y - 2, 2, 0, Math.PI*2);
          ctx.fill();

          // HP Bar
          ctx.fillStyle = 'red';
          ctx.fillRect(ent.x - ent.radius, ent.y - ent.radius - 10, ent.radius * 2, 4);
          ctx.fillStyle = 'green';
          ctx.fillRect(ent.x - ent.radius, ent.y - ent.radius - 10, (ent.hp / ent.maxHp) * (ent.radius * 2), 4);
        }
      }

      // Draw Players
      for (const id in state.players) {
        const p = state.players[id];
        ctx.beginPath();
        ctx.arc(p.x, p.y, 15, 0, Math.PI * 2);
        ctx.fillStyle = id === myId ? '#00f' : '#f00';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Draw player info
        ctx.fillStyle = '#fff';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`Age ${p.age}`, p.x, p.y - 25);
      }

      // Render Fog of War mask
      if (me) {
          const losRadius = 800; // Same as server

          // We draw a large black rectangle covering everything,
          // then cut out a circle around the player using composite operations
          ctx.save();
          ctx.globalCompositeOperation = 'destination-in';

          const gradient = ctx.createRadialGradient(me.x, me.y, losRadius * 0.5, me.x, me.y, losRadius);
          gradient.addColorStop(0, 'rgba(0, 0, 0, 1)');
          gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

          ctx.fillStyle = gradient;
          ctx.beginPath();
          ctx.arc(me.x, me.y, losRadius, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();

          // Draw solid black outside the bounding box of the gradient just in case it doesn't cover the screen
          ctx.globalCompositeOperation = 'destination-over';
          ctx.fillStyle = '#050505';
          ctx.fillRect(me.x - 5000, me.y - 5000, 10000, 10000);
          ctx.globalCompositeOperation = 'source-over';
      }

      ctx.restore();

      // UI overlay
      if (me) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(10, 10, 250, 180);

        ctx.fillStyle = '#fff';
        ctx.textAlign = 'left';
        ctx.font = '16px monospace';
        ctx.fillText(`Age: ${me.age}`, 20, 35);
        ctx.fillText(`HP: ${me.hp}/${me.maxHp}`, 20, 55);
        ctx.fillText(`Wood: ${me.resources.wood}`, 20, 85);
        ctx.fillText(`Stone: ${me.resources.stone}`, 20, 105);
        ctx.fillText(`Iron: ${me.resources.iron}`, 20, 125);

        ctx.fillStyle = '#aaa';
        ctx.font = '12px monospace';
        ctx.fillText(`[E] Gather/Attack`, 20, 150);

        const canAgeUp = me.resources.wood >= ageUpCost.wood &&
                         me.resources.stone >= ageUpCost.stone &&
                         me.resources.iron >= ageUpCost.iron;
        ctx.fillStyle = canAgeUp ? '#4CAF50' : '#f44336';
        ctx.fillText(`[Q] Age Up (${ageUpCost.wood}W ${ageUpCost.stone}S ${ageUpCost.iron}I)`, 20, 170);

        const canBuild = me.resources.wood >= 20 && me.resources.stone >= 10 && me.resources.iron >= 5;
        const distToCenter = Math.sqrt(me.x*me.x + me.y*me.y);
        ctx.fillStyle = (canBuild && distToCenter >= baseZoneRadius) ? '#4CAF50' : '#f44336';
        ctx.fillText(`[B] Build Turret (20W 10S 5I)`, 20, 190);
      }

      animationFrameId = requestAnimationFrame(render);
    };

    connectSocket();
    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('keypress', onKeyPress);
      if (socket) socket.disconnect();
      if (localEngine) localEngine.stop();
    };
  });
</script>

{#if isOffline}
  <div class="offline-banner">
    <span>Offline Mode</span>
    <button onclick={connectSocket}>Reconnect</button>
    <button onclick={resetLocalState} class="danger">Reset Local Instance</button>
  </div>
{/if}

<canvas bind:this={canvas}></canvas>

<div class="mobile-controls">
  <div class="d-pad">
    <div class="d-pad-row">
      <button
        onmousedown={(e) => handleMobileDir('w', true, e)}
        onmouseup={(e) => handleMobileDir('w', false, e)}
        onmouseleave={(e) => handleMobileDir('w', false, e)}
        ontouchstart={(e) => handleMobileDir('w', true, e)}
        ontouchend={(e) => handleMobileDir('w', false, e)}
        ontouchcancel={(e) => handleMobileDir('w', false, e)}>W</button>
    </div>
    <div class="d-pad-row">
      <button
        onmousedown={(e) => handleMobileDir('a', true, e)}
        onmouseup={(e) => handleMobileDir('a', false, e)}
        onmouseleave={(e) => handleMobileDir('a', false, e)}
        ontouchstart={(e) => handleMobileDir('a', true, e)}
        ontouchend={(e) => handleMobileDir('a', false, e)}
        ontouchcancel={(e) => handleMobileDir('a', false, e)}>A</button>
      <button
        onmousedown={(e) => handleMobileDir('s', true, e)}
        onmouseup={(e) => handleMobileDir('s', false, e)}
        onmouseleave={(e) => handleMobileDir('s', false, e)}
        ontouchstart={(e) => handleMobileDir('s', true, e)}
        ontouchend={(e) => handleMobileDir('s', false, e)}
        ontouchcancel={(e) => handleMobileDir('s', false, e)}>S</button>
      <button
        onmousedown={(e) => handleMobileDir('d', true, e)}
        onmouseup={(e) => handleMobileDir('d', false, e)}
        onmouseleave={(e) => handleMobileDir('d', false, e)}
        ontouchstart={(e) => handleMobileDir('d', true, e)}
        ontouchend={(e) => handleMobileDir('d', false, e)}
        ontouchcancel={(e) => handleMobileDir('d', false, e)}>D</button>
    </div>
  </div>
  <div class="action-buttons">
    <button onclick={() => performAction('interact')} ontouchstart={(e) => { e.preventDefault(); performAction('interact'); }}>E (Gather)</button>
    <button onclick={() => performAction('ageUp')} ontouchstart={(e) => { e.preventDefault(); performAction('ageUp'); }}>Q (Age Up)</button>
    <button onclick={() => performAction('build')} ontouchstart={(e) => { e.preventDefault(); performAction('build'); }}>B (Build)</button>
  </div>
</div>

<style>
  canvas {
    display: block;
    width: 100vw;
    height: 100vh;
  }

  .offline-banner {
    position: absolute;
    top: 10px;
    right: 10px;
    background: rgba(255, 85, 85, 0.9);
    color: white;
    padding: 10px 20px;
    border-radius: 5px;
    font-family: monospace;
    display: flex;
    gap: 15px;
    align-items: center;
    z-index: 1000;
  }

  .offline-banner button {
    background: rgba(255, 255, 255, 0.2);
    border: 1px solid white;
    color: white;
    padding: 5px 10px;
    cursor: pointer;
    border-radius: 3px;
    font-family: monospace;
  }

  .offline-banner button:hover {
    background: rgba(255, 255, 255, 0.4);
  }

  .offline-banner button.danger {
    background: rgba(139, 0, 0, 0.5);
    border-color: #ffcccc;
  }

  .offline-banner button.danger:hover {
    background: rgba(139, 0, 0, 0.8);
  }

  /* Mobile Controls */
  .mobile-controls {
    display: none; /* Hidden by default */
    position: absolute;
    bottom: 20px;
    left: 0;
    right: 0;
    justify-content: space-between;
    padding: 0 20px;
    pointer-events: none; /* Let clicks pass through empty space */
    z-index: 1000;
  }

  .mobile-controls .d-pad, .mobile-controls .action-buttons {
    pointer-events: auto; /* Re-enable clicks for buttons */
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .mobile-controls .d-pad {
    align-items: center;
  }

  .mobile-controls .d-pad-row {
    display: flex;
    gap: 10px;
  }

  .mobile-controls button {
    background: rgba(255, 255, 255, 0.3);
    border: 2px solid rgba(255, 255, 255, 0.6);
    color: white;
    font-weight: bold;
    font-family: monospace;
    border-radius: 50%; /* Make them circular */
    width: 60px;
    height: 60px;
    display: flex;
    align-items: center;
    justify-content: center;
    user-select: none; /* Prevent text selection */
    -webkit-user-select: none;
    touch-action: manipulation;
  }

  .mobile-controls .action-buttons button {
    border-radius: 8px; /* Action buttons more rectangular */
    width: auto;
    padding: 0 15px;
    height: 50px;
  }

  .mobile-controls button:active {
    background: rgba(255, 255, 255, 0.6);
  }

  @media (max-width: 768px), (pointer: coarse) {
    .mobile-controls {
      display: flex;
    }
  }
</style>
