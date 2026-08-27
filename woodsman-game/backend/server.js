const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Serve static frontend files in production
app.use(express.static(path.join(__dirname, '../frontend/build')));

// Game State Constants
const GAME_TICK_RATE = 1000 / 30; // 30 updates per second
const BASE_ZONE_RADIUS = 500; // Radius of Zone 0
const MAX_AGE = 100;

const BUILDING_TYPES = {
  turret: {
    cost: { wood: 20, stone: 10, iron: 5 },
    hp: 100,
    radius: 15,
    attackRange: 150,
    attackDamage: 10,
    attackRate: 1000 // ms
  }
};

// Game State
const state = {
  players: {}, // Socket ID -> Player Data
  entities: {}, // ID -> Entity Data (Zombies, Resources, Buildings)
  entityIdCounter: 0,
};

function generateResourceCost(age) {
  // Procedural scaling cost based on age
  // Base cost 10, scales exponentially but manageable
  const mult = Math.pow(1.5, age);
  return {
    wood: Math.floor(10 * mult),
    stone: Math.floor(5 * mult),
    iron: Math.floor(2 * mult)
  };
}

function spawnResource() {
  // Randomly spawn a resource somewhere in the first few zones
  const angle = Math.random() * Math.PI * 2;
  const dist = Math.random() * BASE_ZONE_RADIUS * 4; // Up to zone 3 initially

  const types = ['wood', 'wood', 'stone', 'iron'];
  const type = types[Math.floor(Math.random() * types.length)];

  const id = 'res_' + state.entityIdCounter++;
  state.entities[id] = {
    id: id,
    type: 'resource',
    resourceType: type,
    amount: type === 'wood' ? 10 : (type === 'stone' ? 5 : 2),
    x: Math.cos(angle) * dist,
    y: Math.sin(angle) * dist,
    radius: 10
  };
}

// Initial spawn
for(let i=0; i<100; i++) spawnResource();

// Spawn interval
setInterval(() => {
  if (Object.keys(state.entities).filter(k => state.entities[k].type === 'resource').length < 200) {
    spawnResource();
  }
}, 2000);

// Zombie configuration
const ZOMBIE_BASE_HP = 50;
const ZOMBIE_BASE_SPEED = 100;
const ZOMBIE_BASE_DAMAGE = 10;

function spawnZombie() {
    // Determine maximum player age to spawn outside of it
    let maxAge = 1;
    for (const pid in state.players) {
        if (state.players[pid].age > maxAge) {
            maxAge = state.players[pid].age;
        }
    }

    // Spawn outside the maximum zone active
    const spawnRadius = BASE_ZONE_RADIUS * (maxAge + 2);
    const angle = Math.random() * Math.PI * 2;

    const id = 'zom_' + state.entityIdCounter++;
    state.entities[id] = {
        id: id,
        type: 'zombie',
        x: Math.cos(angle) * spawnRadius,
        y: Math.sin(angle) * spawnRadius,
        hp: ZOMBIE_BASE_HP * (maxAge + 1), // initial hp scales with spawn band
        maxHp: ZOMBIE_BASE_HP * (maxAge + 1),
        speed: ZOMBIE_BASE_SPEED,
        damage: ZOMBIE_BASE_DAMAGE * (maxAge + 1),
        radius: 12,
        lastAttack: 0,
        band: maxAge + 1
    };
}

// Zombie spawner
setInterval(() => {
   if (Object.keys(state.entities).filter(k => state.entities[k].type === 'zombie').length < 100) {
       spawnZombie();
   }
}, 5000);


// Player Class representation (Server side state)
class Player {
  constructor(id) {
    this.id = id;
    this.x = 0;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
    this.age = 0;
    this.resources = { wood: 0, stone: 0, iron: 0 };
    this.hp = 100;
    this.maxHp = 100;
    this.speed = 200; // pixels per second
  }

  getZoneBounds() {
    // Zone 0 bounds: 0 to BASE_ZONE_RADIUS
    // Zone 1 bounds: BASE_ZONE_RADIUS to BASE_ZONE_RADIUS * 2
    // If player is Age N, they can access Zone N and above.
    const innerRadius = this.age * BASE_ZONE_RADIUS;
    return { innerRadius };
  }
}

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  // Initialize new player at 0,0
  state.players[socket.id] = new Player(socket.id);

  // Send initial state to the new player
  socket.emit('init', {
    id: socket.id,
    players: state.players,
    entities: state.entities,
    baseZoneRadius: BASE_ZONE_RADIUS
  });

  // Broadcast to others that a new player joined
  socket.broadcast.emit('playerJoined', state.players[socket.id]);

  socket.on('input', (data) => {
    const player = state.players[socket.id];
    if (player) {
      player.vx = data.dx;
      player.vy = data.dy;
    }
  });

  socket.on('build', (data) => {
    const player = state.players[socket.id];
    if (!player) return;

    const bType = BUILDING_TYPES[data.type];
    if (!bType) return;

    // Check zone logic: cannot build in Zone 0
    const dist = Math.sqrt(player.x * player.x + player.y * player.y);
    if (dist < BASE_ZONE_RADIUS) {
        return; // Cannot build in Zone 0
    }

    // Check costs
    if (player.resources.wood >= bType.cost.wood &&
        player.resources.stone >= bType.cost.stone &&
        player.resources.iron >= bType.cost.iron) {

        // Consume
        player.resources.wood -= bType.cost.wood;
        player.resources.stone -= bType.cost.stone;
        player.resources.iron -= bType.cost.iron;

        // Create building
        const id = 'bldg_' + state.entityIdCounter++;
        state.entities[id] = {
            id: id,
            type: 'building',
            buildingType: data.type,
            owner: socket.id,
            ownerAgeAtBuild: player.age,
            x: player.x,
            y: player.y,
            hp: bType.hp,
            maxHp: bType.hp,
            radius: bType.radius,
            lastAttack: 0
        };
    }
  });

  socket.on('interact', () => {
    const player = state.players[socket.id];
    if (!player) return;

    // Check for resources nearby
    const interactRadius = 50;
    for (const id in state.entities) {
      const entity = state.entities[id];
      if (entity.type === 'resource') {
        const dx = player.x - entity.x;
        const dy = player.y - entity.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist <= interactRadius) {
          // Gather resource
          player.resources[entity.resourceType] += entity.amount;
          delete state.entities[id];
          break; // Gather one at a time
        }
      } else if (entity.type === 'building' && entity.abandoned) {
        const dx = player.x - entity.x;
        const dy = player.y - entity.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist <= interactRadius + entity.radius) {
           // Attack abandoned building
           entity.hp -= 10;
           if (entity.hp <= 0) {
               // Harvest building resources
               player.resources.wood += 5;
               player.resources.stone += 2;
               player.resources.iron += 1;
               delete state.entities[id];
           }
           break;
        }
      } else if (entity.type === 'zombie') {
        const dx = player.x - entity.x;
        const dy = player.y - entity.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist <= interactRadius + entity.radius) {
           // Attack zombie
           entity.hp -= 20; // Player attack damage
           if (entity.hp <= 0) {
               delete state.entities[id];
               // Level up / Reward
               player.resources.wood += 5;
               player.resources.stone += 5;
               player.resources.iron += 5;
           }
           break;
        }
      }
    }
  });

  socket.on('ageUp', () => {
    const player = state.players[socket.id];
    if (!player) return;
    if (player.age >= MAX_AGE) return;

    const cost = generateResourceCost(player.age);
    if (player.resources.wood >= cost.wood &&
        player.resources.stone >= cost.stone &&
        player.resources.iron >= cost.iron) {

      // Consume resources
      player.resources.wood -= cost.wood;
      player.resources.stone -= cost.stone;
      player.resources.iron -= cost.iron;

      // Level up
      player.age++;
      console.log(`Player ${socket.id} reached Age ${player.age}`);

      socket.emit('ageUpSuccess', { age: player.age, newCost: generateResourceCost(player.age) });
    }
  });

  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);
    delete state.players[socket.id];
    io.emit('playerDisconnected', socket.id);
  });
});

// Game Loop
let lastTime = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = (now - lastTime) / 1000;
  lastTime = now;

  // Update players
  for (const id in state.players) {
    const player = state.players[id];

    // Normalize velocity vector
    let mag = Math.sqrt(player.vx * player.vx + player.vy * player.vy);
    let nx = 0, ny = 0;
    if (mag > 0) {
      nx = player.vx / mag;
      ny = player.vy / mag;
    }

    // Attempt movement
    let nextX = player.x + nx * player.speed * dt;
    let nextY = player.y + ny * player.speed * dt;

    // Check zone restrictions
    const distFromCenter = Math.sqrt(nextX * nextX + nextY * nextY);
    const bounds = player.getZoneBounds();

    if (distFromCenter < bounds.innerRadius) {
      // Prevent moving into locked inner zones by pushing outwards
      // (Basic collision response against a circle from the inside out)
      if (distFromCenter > 0) {
        nextX = (nextX / distFromCenter) * bounds.innerRadius;
        nextY = (nextY / distFromCenter) * bounds.innerRadius;
      } else {
        nextX = bounds.innerRadius;
        nextY = 0;
      }
    }

    player.x = nextX;
    player.y = nextY;
  }

  // Update Buildings
  for (const id in state.entities) {
    const ent = state.entities[id];
    if (ent.type === 'building') {
      const owner = state.players[ent.owner];
      // Abandonment check
      // A building is abandoned if the owner's current inner radius has expanded past the building
      const dist = Math.sqrt(ent.x * ent.x + ent.y * ent.y);
      if (owner) {
          const bounds = owner.getZoneBounds();
          if (dist < bounds.innerRadius) {
              ent.abandoned = true;
          } else {
              ent.abandoned = false;
          }
      } else {
          ent.abandoned = true; // Owner left
      }

      // Turret logic
      if (ent.buildingType === 'turret' && now - ent.lastAttack > BUILDING_TYPES.turret.attackRate) {
        // Find target
        let targetId = null;
        let minDist = BUILDING_TYPES.turret.attackRange;

        // Turrets can attack zombies (implemented later)
        // Abandoned turrets attack players
        if (ent.abandoned) {
           for(const pid in state.players) {
              const p = state.players[pid];
              const pdist = Math.sqrt(Math.pow(p.x - ent.x, 2) + Math.pow(p.y - ent.y, 2));
              if (pdist < minDist) {
                 minDist = pdist;
                 targetId = pid;
              }
           }
           if (targetId) {
               state.players[targetId].hp -= BUILDING_TYPES.turret.attackDamage;
               ent.lastAttack = now;
               // Check player death
               if (state.players[targetId].hp <= 0) {
                  // Respawn logic
                  state.players[targetId].hp = state.players[targetId].maxHp;
                  state.players[targetId].x = 0;
                  state.players[targetId].y = 0;
                  state.players[targetId].age = 0;
               }
           }
        }
      }
    }
  }

  // Update zombies
  for (const id in state.entities) {
     const ent = state.entities[id];
     if (ent.type === 'zombie') {
         // March towards center 0,0
         const distToCenter = Math.sqrt(ent.x * ent.x + ent.y * ent.y);

         // Calculate current band based on radius
         const currentBand = Math.floor(distToCenter / BASE_ZONE_RADIUS);

         // If they entered Zone 0, they burst into flames and turn to ash (die instantly)
         if (distToCenter < BASE_ZONE_RADIUS) {
             delete state.entities[id];
             continue;
         }

         // Downgrade logic: if band decreases, scale down stats
         if (currentBand < ent.band) {
             ent.band = currentBand;
             ent.maxHp = ZOMBIE_BASE_HP * (ent.band + 1);
             if (ent.hp > ent.maxHp) ent.hp = ent.maxHp;
             ent.damage = ZOMBIE_BASE_DAMAGE * (ent.band + 1);
         }

         // Movement
         let nx = -ent.x / distToCenter;
         let ny = -ent.y / distToCenter;

         // Check for nearby targets (Players or active Turrets)
         let target = null;
         let minDist = 200;

         // Check players
         for (const pid in state.players) {
             const p = state.players[pid];
             const d = Math.sqrt(Math.pow(p.x - ent.x, 2) + Math.pow(p.y - ent.y, 2));
             if (d < minDist) {
                 minDist = d;
                 target = p;
             }
         }

         // Check buildings
         for (const bid in state.entities) {
             const b = state.entities[bid];
             if (b.type === 'building' && !b.abandoned) {
                 const d = Math.sqrt(Math.pow(b.x - ent.x, 2) + Math.pow(b.y - ent.y, 2));
                 if (d < minDist) {
                     minDist = d;
                     target = b;
                 }
             }
         }

         if (target) {
             // Move towards target instead of center
             const dx = target.x - ent.x;
             const dy = target.y - ent.y;
             const d = Math.sqrt(dx*dx + dy*dy);
             nx = dx/d;
             ny = dy/d;

             // Attack
             if (d < ent.radius + (target.radius || 15)) { // Hitbox approximation
                 if (now - ent.lastAttack > 1000) {
                     target.hp -= ent.damage;
                     ent.lastAttack = now;

                     if (target.hp <= 0) {
                         if (target.type === 'building') {
                             delete state.entities[target.id];
                         } else {
                             // Player dies
                             target.hp = target.maxHp;
                             target.x = 0;
                             target.y = 0;
                             target.age = 0; // Reset age on death (punishing, but fits survival)
                         }
                     }
                 }
             }
         }

         ent.x += nx * ent.speed * dt;
         ent.y += ny * ent.speed * dt;
     }
  }

  // Update Turret aiming at zombies
  for (const bid in state.entities) {
      const b = state.entities[bid];
      if (b.type === 'building' && b.buildingType === 'turret' && !b.abandoned && now - b.lastAttack > BUILDING_TYPES.turret.attackRate) {
          // Find nearest zombie
          let targetId = null;
          let minDist = BUILDING_TYPES.turret.attackRange;

          for (const zid in state.entities) {
              const z = state.entities[zid];
              if (z.type === 'zombie') {
                  const d = Math.sqrt(Math.pow(z.x - b.x, 2) + Math.pow(z.y - b.y, 2));
                  if (d < minDist) {
                      minDist = d;
                      targetId = zid;
                  }
              }
          }

          if (targetId) {
              const target = state.entities[targetId];
              target.hp -= BUILDING_TYPES.turret.attackDamage;
              b.lastAttack = now;

              if (target.hp <= 0) {
                  delete state.entities[targetId];
                  // Give owner some resource or XP? (Skipping for now)
              }
          }
      }
  }

  // Broadcast state update (Fog of War)
  const PLAYER_LOS_RADIUS = 800;

  for (const socketId in state.players) {
      const p = state.players[socketId];
      const visiblePlayers = {};
      const visibleEntities = {};

      // Always see yourself
      visiblePlayers[socketId] = p;

      // Check other players
      for (const otherId in state.players) {
          if (socketId === otherId) continue;
          const op = state.players[otherId];
          const dist = Math.sqrt(Math.pow(p.x - op.x, 2) + Math.pow(p.y - op.y, 2));
          if (dist <= PLAYER_LOS_RADIUS) {
              visiblePlayers[otherId] = op;
          }
      }

      // Check entities
      for (const entId in state.entities) {
          const ent = state.entities[entId];
          const dist = Math.sqrt(Math.pow(p.x - ent.x, 2) + Math.pow(p.y - ent.y, 2));
          if (dist <= PLAYER_LOS_RADIUS) {
              visibleEntities[entId] = ent;
          }
      }

      io.to(socketId).emit('stateUpdate', {
          players: visiblePlayers,
          entities: visibleEntities
      });
  }

}, GAME_TICK_RATE);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
