// Constants
export const GAME_TICK_RATE = 1000 / 30; // 30 updates per second
export const BASE_ZONE_RADIUS = 500; // Radius of Zone 0
export const MAX_AGE = 100;

export const BUILDING_TYPES = {
  turret: {
    cost: { wood: 20, stone: 10, iron: 5 },
    hp: 100,
    radius: 15,
    attackRange: 150,
    attackDamage: 10,
    attackRate: 1000 // ms
  }
};

const ZOMBIE_BASE_HP = 50;
const ZOMBIE_BASE_SPEED = 100;
const ZOMBIE_BASE_DAMAGE = 10;

export function generateResourceCost(age: number) {
  const mult = Math.pow(1.5, age);
  return {
    wood: Math.floor(10 * mult),
    stone: Math.floor(5 * mult),
    iron: Math.floor(2 * mult)
  };
}

class Player {
  id: string;
  x: number = 0;
  y: number = 0;
  vx: number = 0;
  vy: number = 0;
  age: number = 0;
  resources: { wood: number, stone: number, iron: number } = { wood: 0, stone: 0, iron: 0 };
  hp: number = 100;
  maxHp: number = 100;
  speed: number = 200;

  constructor(id: string) {
    this.id = id;
  }

  getZoneBounds() {
    const innerRadius = this.age * BASE_ZONE_RADIUS;
    return { innerRadius };
  }
}

export class LocalGameEngine {
  state: {
    players: Record<string, any>;
    entities: Record<string, any>;
    entityIdCounter: number;
  };

  myId: string;
  gameLoopInterval: any;
  resourceSpawnerInterval: any;
  zombieSpawnerInterval: any;
  saveInterval: any;
  lastTime: number;

  onInit: (data: any) => void = () => {};
  onStateUpdate: (data: any) => void = () => {};
  onAgeUpSuccess: (data: any) => void = () => {};

  constructor(myId: string = 'local_player') {
    this.myId = myId;
    this.state = {
      players: {},
      entities: {},
      entityIdCounter: 0
    };
    this.lastTime = Date.now();
  }

  start() {
    this.loadState();

    if (!this.state.players[this.myId]) {
      // Initial State setup
      this.state.players[this.myId] = new Player(this.myId);

      // Initial spawn
      for(let i=0; i<100; i++) this.spawnResource();
    }

    this.onInit({
      id: this.myId,
      players: this.state.players,
      entities: this.state.entities,
      baseZoneRadius: BASE_ZONE_RADIUS
    });

    this.resourceSpawnerInterval = setInterval(() => {
      if (Object.keys(this.state.entities).filter(k => this.state.entities[k].type === 'resource').length < 200) {
        this.spawnResource();
      }
    }, 2000);

    this.zombieSpawnerInterval = setInterval(() => {
       if (Object.keys(this.state.entities).filter(k => this.state.entities[k].type === 'zombie').length < 100) {
           this.spawnZombie();
       }
    }, 5000);

    this.saveInterval = setInterval(() => {
      this.saveState();
    }, 5000);

    this.lastTime = Date.now();
    this.gameLoopInterval = setInterval(() => this.gameLoop(), GAME_TICK_RATE);
  }

  saveState() {
    try {
      localStorage.setItem('woodsman_local_state', JSON.stringify(this.state));
    } catch (e) {
      console.error('Failed to save state to localStorage:', e);
    }
  }

  loadState() {
    try {
      const saved = localStorage.getItem('woodsman_local_state');
      if (saved) {
        this.state = JSON.parse(saved);
        // Ensure player is instantiated properly if needed, but simple objects work for state
      }
    } catch (e) {
      console.error('Failed to load state from localStorage:', e);
    }
  }

  reset() {
    this.stop();
    localStorage.removeItem('woodsman_local_state');
    this.state = {
      players: {},
      entities: {},
      entityIdCounter: 0
    };
    this.start();
  }

  stop() {
    clearInterval(this.resourceSpawnerInterval);
    clearInterval(this.zombieSpawnerInterval);
    clearInterval(this.gameLoopInterval);
    clearInterval(this.saveInterval);
  }

  spawnResource() {
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.random() * BASE_ZONE_RADIUS * 4;

    const types = ['wood', 'wood', 'stone', 'iron'];
    const type = types[Math.floor(Math.random() * types.length)];

    const id = 'res_' + this.state.entityIdCounter++;
    this.state.entities[id] = {
      id: id,
      type: 'resource',
      resourceType: type,
      amount: type === 'wood' ? 10 : (type === 'stone' ? 5 : 2),
      x: Math.cos(angle) * dist,
      y: Math.sin(angle) * dist,
      radius: 10
    };
  }

  spawnZombie() {
    let maxAge = 1;
    for (const pid in this.state.players) {
        if (this.state.players[pid].age > maxAge) {
            maxAge = this.state.players[pid].age;
        }
    }

    const spawnRadius = BASE_ZONE_RADIUS * (maxAge + 2);
    const angle = Math.random() * Math.PI * 2;

    const id = 'zom_' + this.state.entityIdCounter++;
    this.state.entities[id] = {
        id: id,
        type: 'zombie',
        x: Math.cos(angle) * spawnRadius,
        y: Math.sin(angle) * spawnRadius,
        hp: ZOMBIE_BASE_HP * (maxAge + 1),
        maxHp: ZOMBIE_BASE_HP * (maxAge + 1),
        speed: ZOMBIE_BASE_SPEED,
        damage: ZOMBIE_BASE_DAMAGE * (maxAge + 1),
        radius: 12,
        lastAttack: 0,
        band: maxAge + 1
    };
  }

  input(data: { dx: number, dy: number }) {
    const player = this.state.players[this.myId];
    if (player) {
      player.vx = data.dx;
      player.vy = data.dy;
    }
  }

  build(data: { type: keyof typeof BUILDING_TYPES }) {
    const player = this.state.players[this.myId];
    if (!player) return;

    const bType = BUILDING_TYPES[data.type];
    if (!bType) return;

    const dist = Math.sqrt(player.x * player.x + player.y * player.y);
    if (dist < BASE_ZONE_RADIUS) {
        return;
    }

    if (player.resources.wood >= bType.cost.wood &&
        player.resources.stone >= bType.cost.stone &&
        player.resources.iron >= bType.cost.iron) {

        player.resources.wood -= bType.cost.wood;
        player.resources.stone -= bType.cost.stone;
        player.resources.iron -= bType.cost.iron;

        const id = 'bldg_' + this.state.entityIdCounter++;
        this.state.entities[id] = {
            id: id,
            type: 'building',
            buildingType: data.type,
            owner: this.myId,
            ownerAgeAtBuild: player.age,
            x: player.x,
            y: player.y,
            hp: bType.hp,
            maxHp: bType.hp,
            radius: bType.radius,
            lastAttack: 0
        };
    }
  }

  interact() {
    const player = this.state.players[this.myId];
    if (!player) return;

    const interactRadius = 50;
    for (const id in this.state.entities) {
      const entity = this.state.entities[id];
      if (entity.type === 'resource') {
        const dx = player.x - entity.x;
        const dy = player.y - entity.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist <= interactRadius) {
          player.resources[entity.resourceType] += entity.amount;
          delete this.state.entities[id];
          break;
        }
      } else if (entity.type === 'building' && entity.abandoned) {
        const dx = player.x - entity.x;
        const dy = player.y - entity.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist <= interactRadius + entity.radius) {
           entity.hp -= 10;
           if (entity.hp <= 0) {
               player.resources.wood += 5;
               player.resources.stone += 2;
               player.resources.iron += 1;
               delete this.state.entities[id];
           }
           break;
        }
      } else if (entity.type === 'zombie') {
        const dx = player.x - entity.x;
        const dy = player.y - entity.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist <= interactRadius + entity.radius) {
           entity.hp -= 20;
           if (entity.hp <= 0) {
               delete this.state.entities[id];
               player.resources.wood += 5;
               player.resources.stone += 5;
               player.resources.iron += 5;
           }
           break;
        }
      }
    }
  }

  ageUp() {
    const player = this.state.players[this.myId];
    if (!player) return;
    if (player.age >= MAX_AGE) return;

    const cost = generateResourceCost(player.age);
    if (player.resources.wood >= cost.wood &&
        player.resources.stone >= cost.stone &&
        player.resources.iron >= cost.iron) {

      player.resources.wood -= cost.wood;
      player.resources.stone -= cost.stone;
      player.resources.iron -= cost.iron;

      player.age++;

      this.onAgeUpSuccess({ age: player.age, newCost: generateResourceCost(player.age) });
    }
  }

  gameLoop() {
    const now = Date.now();
    const dt = (now - this.lastTime) / 1000;
    this.lastTime = now;

    // Update players
    for (const id in this.state.players) {
      const player = this.state.players[id];

      let mag = Math.sqrt(player.vx * player.vx + player.vy * player.vy);
      let nx = 0, ny = 0;
      if (mag > 0) {
        nx = player.vx / mag;
        ny = player.vy / mag;
      }

      let nextX = player.x + nx * player.speed * dt;
      let nextY = player.y + ny * player.speed * dt;

      const distFromCenter = Math.sqrt(nextX * nextX + nextY * nextY);

      // Need to dynamically recreate getZoneBounds if loading from generic object
      const innerRadius = player.age * BASE_ZONE_RADIUS;

      if (distFromCenter < innerRadius) {
        if (distFromCenter > 0) {
          nextX = (nextX / distFromCenter) * innerRadius;
          nextY = (nextY / distFromCenter) * innerRadius;
        } else {
          nextX = innerRadius;
          nextY = 0;
        }
      }

      player.x = nextX;
      player.y = nextY;
    }

    // Update Buildings
    for (const id in this.state.entities) {
      const ent = this.state.entities[id];
      if (ent.type === 'building') {
        const owner = this.state.players[ent.owner];
        const dist = Math.sqrt(ent.x * ent.x + ent.y * ent.y);
        if (owner) {
            const innerRadius = owner.age * BASE_ZONE_RADIUS;
            if (dist < innerRadius) {
                ent.abandoned = true;
            } else {
                ent.abandoned = false;
            }
        } else {
            ent.abandoned = true;
        }

        if (ent.buildingType === 'turret' && now - ent.lastAttack > BUILDING_TYPES.turret.attackRate) {
          let targetId = null;
          let minDist = BUILDING_TYPES.turret.attackRange;

          if (ent.abandoned) {
             for(const pid in this.state.players) {
                const p = this.state.players[pid];
                const pdist = Math.sqrt(Math.pow(p.x - ent.x, 2) + Math.pow(p.y - ent.y, 2));
                if (pdist < minDist) {
                   minDist = pdist;
                   targetId = pid;
                }
             }
             if (targetId) {
                 this.state.players[targetId].hp -= BUILDING_TYPES.turret.attackDamage;
                 ent.lastAttack = now;
                 if (this.state.players[targetId].hp <= 0) {
                    this.state.players[targetId].hp = this.state.players[targetId].maxHp;
                    this.state.players[targetId].x = 0;
                    this.state.players[targetId].y = 0;
                    this.state.players[targetId].age = 0;
                 }
             }
          }
        }
      }
    }

    // Update zombies
    for (const id in this.state.entities) {
       const ent = this.state.entities[id];
       if (ent.type === 'zombie') {
           const distToCenter = Math.sqrt(ent.x * ent.x + ent.y * ent.y);
           const currentBand = Math.floor(distToCenter / BASE_ZONE_RADIUS);

           if (distToCenter < BASE_ZONE_RADIUS) {
               delete this.state.entities[id];
               continue;
           }

           if (currentBand < ent.band) {
               ent.band = currentBand;
               ent.maxHp = ZOMBIE_BASE_HP * (ent.band + 1);
               if (ent.hp > ent.maxHp) ent.hp = ent.maxHp;
               ent.damage = ZOMBIE_BASE_DAMAGE * (ent.band + 1);
           }

           let nx = -ent.x / distToCenter;
           let ny = -ent.y / distToCenter;

           let target = null;
           let minDist = 200;

           for (const pid in this.state.players) {
               const p = this.state.players[pid];
               const d = Math.sqrt(Math.pow(p.x - ent.x, 2) + Math.pow(p.y - ent.y, 2));
               if (d < minDist) {
                   minDist = d;
                   target = p;
               }
           }

           for (const bid in this.state.entities) {
               const b = this.state.entities[bid];
               if (b.type === 'building' && !b.abandoned) {
                   const d = Math.sqrt(Math.pow(b.x - ent.x, 2) + Math.pow(b.y - ent.y, 2));
                   if (d < minDist) {
                       minDist = d;
                       target = b;
                   }
               }
           }

           if (target) {
               const dx = target.x - ent.x;
               const dy = target.y - ent.y;
               const d = Math.sqrt(dx*dx + dy*dy);
               nx = dx/d;
               ny = dy/d;

               if (d < ent.radius + (target.radius || 15)) {
                   if (now - ent.lastAttack > 1000) {
                       target.hp -= ent.damage;
                       ent.lastAttack = now;

                       if (target.hp <= 0) {
                           if (target.type === 'building') {
                               delete this.state.entities[target.id];
                           } else {
                               target.hp = target.maxHp;
                               target.x = 0;
                               target.y = 0;
                               target.age = 0;
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
    for (const bid in this.state.entities) {
        const b = this.state.entities[bid];
        if (b.type === 'building' && b.buildingType === 'turret' && !b.abandoned && now - b.lastAttack > BUILDING_TYPES.turret.attackRate) {
            let targetId = null;
            let minDist = BUILDING_TYPES.turret.attackRange;

            for (const zid in this.state.entities) {
                const z = this.state.entities[zid];
                if (z.type === 'zombie') {
                    const d = Math.sqrt(Math.pow(z.x - b.x, 2) + Math.pow(z.y - b.y, 2));
                    if (d < minDist) {
                        minDist = d;
                        targetId = zid;
                    }
                }
            }

            if (targetId) {
                const target = this.state.entities[targetId];
                target.hp -= BUILDING_TYPES.turret.attackDamage;
                b.lastAttack = now;

                if (target.hp <= 0) {
                    delete this.state.entities[targetId];
                }
            }
        }
    }

    // Broadcast state update (Fog of War) - Simplified for single player, just send all since client filters
    this.onStateUpdate({
        players: this.state.players,
        entities: this.state.entities
    });
  }
}
