// Tank meshes: the enemy variants and the ally tanks with their name tags (WF-21, moved in WF-34).
import { ICE_BLUE, ALLY_VARIANT, dimColor } from './config.js';
import { wireGroup } from './scene.js';
/* ════════════════════════ enemy tanks ════════════════════════ */
// Side profile (x forward, y up) extruded across the tank's width; the result points down -z like the camera.
export function profileGeometry(points, width) {
  var shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (var i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  var geo = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
  geo.translate(0, 0, -width / 2);
  geo.rotateY(Math.PI / 2);
  return geo;
}

export function lightStrip(points, color) {
  var geo = new THREE.BufferGeometry().setFromPoints(
    points.map(function (p) {
      return new THREE.Vector3(p[0], p[1], p[2]);
    }),
  );
  return new THREE.Line(geo, new THREE.LineBasicMaterial({ color: color }));
}

// WF-21: low, sleek Tron-style tank. Dark faces, bright edges, white-hot light strips for the bloom to catch.
export function makeEnemyMesh(variant) {
  var c = variant.color,
    cDim = dimColor(c, 0.12);
  var glow = new THREE.Color(c).lerp(new THREE.Color(0xffffff), 0.55).getHex();
  var g = new THREE.Group();

  var hull = wireGroup(
    profileGeometry(
      [
        [-1.5, 0.15],
        [1.45, 0.15],
        [1.85, 0.42],
        [1.0, 0.78],
        [-1.25, 0.74],
        [-1.55, 0.42],
      ],
      1.9,
    ),
    c,
    true,
    cDim,
  );
  g.add(hull);

  [-1.12, 1.12].forEach(function (sx) {
    var pod = wireGroup(
      profileGeometry(
        [
          [-1.6, 0.05],
          [1.6, 0.05],
          [1.78, 0.3],
          [1.5, 0.55],
          [-1.5, 0.55],
          [-1.75, 0.3],
        ],
        0.34,
      ),
      c,
      true,
      cDim,
    );
    pod.position.x = sx;
    g.add(pod);
    g.add(
      lightStrip(
        [
          [sx + Math.sign(sx) * 0.18, 0.3, 1.7],
          [sx + Math.sign(sx) * 0.18, 0.3, -1.72],
        ],
        glow,
      ),
    );
  });
  // Rises to 0.72 at the front so the crossbar sits just above the sloped hull top.
  g.add(
    lightStrip(
      [
        [-0.96, 0.6, 1.3],
        [-0.96, 0.72, -1.2],
        [0.96, 0.72, -1.2],
        [0.96, 0.6, 1.3],
      ],
      glow,
    ),
  );

  var turret = wireGroup(new THREE.CylinderGeometry(0.55, 0.82, 0.42, 6), c, true, cDim);
  turret.position.set(0, 0.97, 0.15);
  g.add(turret);
  var ring = [];
  for (var i = 0; i <= 6; i++) {
    var a = (i / 6) * Math.PI * 2;
    // CylinderGeometry puts its corners at (sin, cos); match it so the ring follows the turret's hexagon.
    ring.push([Math.sin(a) * 0.84, 0.79, 0.15 + Math.cos(a) * 0.84]);
  }
  g.add(lightStrip(ring, glow));

  var heavy = variant.name === 'heavy',
    scout = variant.name === 'scout';
  var barrelLen = heavy ? 2.0 : 2.4;
  var barrelR = heavy ? 0.11 : scout ? 0.055 : 0.075;
  (heavy ? [-0.22, 0.22] : [0]).forEach(function (bx) {
    var barrel = wireGroup(new THREE.CylinderGeometry(barrelR, barrelR * 1.2, barrelLen, 8), c, true, cDim);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(bx, 1.0, -0.45 - barrelLen / 2);
    g.add(barrel);
  });

  if (scout) {
    [-0.55, 0.55].forEach(function (fx) {
      var fin = wireGroup(
        profileGeometry(
          [
            [-1.45, 0.72],
            [-0.8, 0.72],
            [-1.3, 1.25],
          ],
          0.06,
        ),
        c,
        true,
        cDim,
      );
      fin.position.x = fx;
      g.add(fin);
    });
  }

  g.scale.setScalar(variant.scale);
  return g;
}

export function makeNameTag(text) {
  var cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 64;
  var cx = cv.getContext('2d');
  cx.font = "700 30px 'Orbitron', sans-serif";
  cx.textAlign = 'center';
  cx.textBaseline = 'middle';
  cx.shadowColor = '#' + new THREE.Color(ICE_BLUE).getHexString();
  cx.shadowBlur = 10;
  cx.fillStyle = '#eafff1';
  cx.fillText(text, 128, 32);
  var tex = new THREE.CanvasTexture(cv);
  var mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  var sprite = new THREE.Sprite(mat);
  sprite.scale.set(4.2, 1.05, 1);
  sprite.position.y = 2.6;
  return sprite;
}

export function makeAllyGroup(name) {
  var g = new THREE.Group();
  g.add(makeEnemyMesh(ALLY_VARIANT));
  g.add(makeNameTag(name));
  return g;
}
