// ═══════════════════════════════════════════════════════════
//  KilnScan Pro — Motor matemático y de visualización
//  Compartido entre index.html y fabrica.html
// ═══════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────
//  1. REGRESIÓN CIRCULAR — Método de Kasa (mínimos cuadrados)
//     Entrada: array de {x, y} en mm
//     Salida:  { cx, cy, r, residuals[], rmse, ovalityPct, dmax, dmin }
// ─────────────────────────────────────────────────────────────
function circularRegression(points) {
  const n = points.length;
  if (n < 3) return null;

  // Kasa method: minimize sum of (x²+y²-2cx·x-2cy·y-c)²
  // Forms system Ax = b
  let sumX=0,sumY=0,sumX2=0,sumY2=0,sumXY=0;
  let sumX3=0,sumY3=0,sumX2Y=0,sumXY2=0;

  points.forEach(p=>{
    const x=p.x, y=p.y;
    const x2=x*x, y2=y*y;
    sumX+=x; sumY+=y; sumX2+=x2; sumY2+=y2; sumXY+=x*y;
    sumX3+=x2*x; sumY3+=y2*y; sumX2Y+=x2*y; sumXY2+=x*y2;
  });

  // Matrix form
  const a11=sumX2, a12=sumXY, a13=sumX;
  const a21=sumXY, a22=sumY2, a23=sumY;
  const a31=sumX,  a32=sumY,  a33=n;

  const b1=sumX3+sumXY2;
  const b2=sumX2Y+sumY3;
  const b3=sumX2+sumY2;

  // Solve 3×3 via Cramer's rule
  function det3(m){
    return m[0]*(m[4]*m[8]-m[5]*m[7])
          -m[1]*(m[3]*m[8]-m[5]*m[6])
          +m[2]*(m[3]*m[7]-m[4]*m[6]);
  }
  const M=[a11,a12,a13,a21,a22,a23,a31,a32,a33];
  const D=det3(M);
  if(Math.abs(D)<1e-10) return null;

  const c1=det3([b1,a12,a13,b2,a22,a23,b3,a32,a33])/D;
  const c2=det3([a11,b1,a13,a21,b2,a23,a31,b3,a33])/D;
  const c3=det3([a11,a12,b1,a21,a22,b2,a31,a32,b3])/D;

  const cx=c1/2, cy=c2/2;
  const r=Math.sqrt(c3+cx*cx+cy*cy);

  // Residuals (signed distance from fitted circle)
  const residuals=points.map(p=>{
    const d=Math.sqrt((p.x-cx)**2+(p.y-cy)**2);
    return d-r;
  });
  const rmse=Math.sqrt(residuals.reduce((s,e)=>s+e*e,0)/n);

  // Convert to polar for ovalidad calculation
  const radii=points.map(p=>Math.sqrt((p.x-cx)**2+(p.y-cy)**2));
  const dmax=Math.max(...radii), dmin=Math.min(...radii);
  const ovalityPct=r>0 ? ((dmax-dmin)/r)*100 : 0;

  // Angle of each point relative to fitted center
  const angles=points.map(p=>({
    a: Math.atan2(p.y-cy, p.x-cx)*180/Math.PI,
    r: Math.sqrt((p.x-cx)**2+(p.y-cy)**2),
    residual: Math.sqrt((p.x-cx)**2+(p.y-cy)**2)-r
  }));

  return { cx, cy, r, residuals, rmse, ovalityPct, dmax, dmin, angles, n };
}

// ─────────────────────────────────────────────────────────────
//  2. Convertir puntos cartesianos a polares relativo al centro ajustado
// ─────────────────────────────────────────────────────────────
function cartToPolar(points, cx, cy) {
  return points.map(p=>({
    a: ((Math.atan2(p.y-cy, p.x-cx)*180/Math.PI)+360)%360,
    r: Math.sqrt((p.x-cx)**2+(p.y-cy)**2),
    x: p.x, y: p.y
  }));
}

// ─────────────────────────────────────────────────────────────
//  3. Convertir polar a cartesiano
// ─────────────────────────────────────────────────────────────
function polarToCart(points) {
  return points.map(p=>({
    x: p.r*Math.cos(p.a*Math.PI/180),
    y: p.r*Math.sin(p.a*Math.PI/180),
    a: p.a, r: p.r
  }));
}

// ─────────────────────────────────────────────────────────────
//  4. Calcular métricas de una sección
// ─────────────────────────────────────────────────────────────
function calcSectionMetrics(section, dnom) {
  const mode = section.inputMode || 'cartesian';
  const pts = section.points || [];
  if (!pts.length) return { ovalityPct:0, dmax:dnom/2, dmin:dnom/2, cx:0, cy:0, r:dnom/2, rmse:0, fit:null };

  let cartPts;
  if (mode === 'cartesian') {
    cartPts = pts.filter(p=>p.x!==undefined && p.y!==undefined);
  } else {
    cartPts = polarToCart(pts);
  }
  if (cartPts.length < 3) {
    const radii = mode==='polar' ? pts.map(p=>p.r) : pts.map(p=>Math.sqrt(p.x**2+p.y**2));
    const dmax=Math.max(...radii)||dnom/2, dmin=Math.min(...radii)||dnom/2;
    return { ovalityPct:((dmax-dmin)/(dnom/2))*100, dmax, dmin, cx:0, cy:0, r:dnom/2, rmse:0, fit:null };
  }

  const fit = circularRegression(cartPts);
  if (!fit) return { ovalityPct:0, dmax:dnom/2, dmin:dnom/2, cx:0, cy:0, r:dnom/2, rmse:0, fit:null };

  return {
    ovalityPct: fit.ovalityPct,
    dmax: fit.dmax,
    dmin: fit.dmin,
    cx: fit.cx,
    cy: fit.cy,
    r: fit.r,
    rmse: fit.rmse,
    fit,
    cartPts
  };
}

// ─────────────────────────────────────────────────────────────
//  5. Máxima ovalidad de un proyecto
// ─────────────────────────────────────────────────────────────
function maxOvalityProject(p) {
  if (!p.sections_data) return 0;
  let mx = 0;
  Object.values(p.sections_data).forEach(s=>{
    const m = calcSectionMetrics(s, p.diam);
    if (m.ovalityPct > mx) mx = m.ovalityPct;
  });
  return mx;
}

function projectStatusLevel(p) {
  const tol = p.tolerance || 0.5;
  const mx = maxOvalityProject(p);
  return mx > tol*2 ? 'crit' : mx > tol ? 'warn' : 'ok';
}

// ─────────────────────────────────────────────────────────────
//  6. Colores semáforo
// ─────────────────────────────────────────────────────────────
function ovColor(pct, tol) {
  if (pct > tol*2) return '#ff4d4d';
  if (pct > tol)   return '#f5c518';
  return '#39e07a';
}
function hexA(hex, alpha) {
  const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ─────────────────────────────────────────────────────────────
//  7. DIBUJO: Horno cilíndrico inclinado (vista isométrica real)
//     Parámetros:
//       canvas  - elemento canvas
//       project - objeto proyecto
//       activeSec - índice sección activa
//       height  - altura canvas
//       onClick - callback(secIdx)
// ─────────────────────────────────────────────────────────────
function drawKilnCylinder(canvas, project, activeSec, height, onClick) {
  const W = canvas.offsetWidth || 700;
  canvas.width = W; canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, height);

  const p = project;
  const tol = p.tolerance || 0.5;
  const nsec = p.sections || 1;
  const angle = p.inclination || 3.5; // grados de inclinación del horno
  const rad = angle * Math.PI / 180;

  // Dimensiones del cilindro proyectado
  const margin = 48;
  const totalW = W - margin*2;
  const cylH = height * 0.52;        // altura de la sección circular (radio proyectado)
  const rise = Math.tan(rad) * totalW; // subida total por inclinación
  const secW = totalW / nsec;

  // Centro vertical del cilindro en el canvas
  const midY = height * 0.48;

  // Función: obtener los 4 puntos de un segmento del cilindro
  function segmentPoints(i) {
    // x izquierdo y derecho del segmento
    const x0 = margin + i * secW;
    const x1 = margin + (i+1) * secW;
    // y de la línea central (inclinada)
    const y0c = midY + (totalW - (x0-margin)) * Math.tan(rad) * 0.4;
    const y1c = midY + (totalW - (x1-margin)) * Math.tan(rad) * 0.4;

    // Perspectiva: segmentos más a la derecha (salida) se ven más pequeños
    const scaleL = 0.7 + 0.3*(1 - i/nsec);
    const scaleR = 0.7 + 0.3*(1 - (i+1)/nsec);
    const rL = cylH * scaleL;
    const rR = cylH * scaleR;

    return { x0, x1, y0c, y1c, rL, rR };
  }

  // Dibujar secciones de atrás hacia adelante (pintor)
  for (let i = nsec-1; i >= 0; i--) {
    const sd = p.sections_data?.[i] || { points: [] };
    const metrics = calcSectionMetrics(sd, p.diam);
    const ov = metrics.ovalityPct;
    const col = ovColor(ov, tol);
    const { x0, x1, y0c, y1c, rL, rR } = segmentPoints(i);
    const isActive = i === activeSec;

    // ── Fill lateral del segmento ──
    const grad = ctx.createLinearGradient(x0, y0c-rL, x1, y1c-rR);
    grad.addColorStop(0, hexA(col, isActive ? 0.30 : 0.14));
    grad.addColorStop(0.5, hexA(col, isActive ? 0.18 : 0.08));
    grad.addColorStop(1, hexA(col, isActive ? 0.30 : 0.14));

    ctx.beginPath();
    ctx.moveTo(x0, y0c - rL);
    ctx.lineTo(x1, y1c - rR);
    // Elipse derecha (top arc)
    ctx.ellipse(x1, y1c, secW*0.12, rR, 0, -Math.PI/2, Math.PI/2);
    ctx.lineTo(x0, y0c + rL);
    // Elipse izquierda (bottom arc, reversed)
    ctx.ellipse(x0, y0c, secW*0.12, rL, 0, Math.PI/2, -Math.PI/2);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // ── Bordes laterales ──
    ctx.strokeStyle = hexA(col, isActive ? 0.8 : 0.35);
    ctx.lineWidth = isActive ? 1.5 : 0.7;
    ctx.beginPath();
    ctx.moveTo(x0, y0c - rL); ctx.lineTo(x1, y1c - rR);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x0, y0c + rL); ctx.lineTo(x1, y1c + rR);
    ctx.stroke();

    // ── Elipse de la cara derecha del segmento ──
    ctx.beginPath();
    ctx.ellipse(x1, y1c, secW*0.12, rR, 0, 0, Math.PI*2);
    ctx.fillStyle = hexA(col, 0.08);
    ctx.fill();
    ctx.strokeStyle = hexA(col, isActive ? 0.7 : 0.3);
    ctx.lineWidth = isActive ? 1.2 : 0.5;
    ctx.stroke();

    // ── Elipse cara izquierda (solo si es el primer segmento) ──
    if (i === 0) {
      ctx.beginPath();
      ctx.ellipse(x0, y0c, secW*0.12, rL, 0, 0, Math.PI*2);
      ctx.fillStyle = hexA(col, 0.05);
      ctx.fill();
      ctx.strokeStyle = hexA(col, 0.4);
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }

    // ── Highlight activo ──
    if (isActive) {
      ctx.strokeStyle = '#00d4ff';
      ctx.lineWidth = 2;
      ctx.shadowColor = '#00d4ff';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(x0, y0c - rL); ctx.lineTo(x1, y1c - rR);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x0, y0c + rL); ctx.lineTo(x1, y1c + rR);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // ── Label ovalidad sobre la sección ──
    const midX = (x0+x1)/2;
    const midYc = (y0c+y1c)/2;
    ctx.fillStyle = isActive ? '#00d4ff' : col;
    ctx.font = `600 ${isActive?11:10}px DM Mono, monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(`${ov.toFixed(2)}%`, midX, midYc - (rL+rR)/2*0.5);

    // ── Label sección ──
    ctx.fillStyle = isActive ? '#00d4ff' : '#2a3855';
    ctx.font = `700 10px Barlow Condensed, sans-serif`;
    ctx.fillText(`S${i+1}`, midX, midYc + (rL+rR)/2*0.55 + 14);
  }

  // ── Eje del horno (línea punteada inclinada) ──
  ctx.setLineDash([5,4]);
  ctx.strokeStyle = '#1a2236';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  const { y0c: yStart } = segmentPoints(0);
  const { x1: xEnd, y1c: yEnd } = segmentPoints(nsec-1);
  ctx.moveTo(margin, yStart);
  ctx.lineTo(xEnd, yEnd);
  ctx.stroke();
  ctx.setLineDash([]);

  // ── Labels entrada / salida ──
  ctx.fillStyle = '#1e2638';
  ctx.font = '9px Barlow, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('ENTRADA', margin + 16, height - 10);
  ctx.fillText('SALIDA', W - margin - 10, height - 10);

  // ── Click handler ──
  canvas.onclick = function(e) {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    for (let i = 0; i < nsec; i++) {
      const { x0, x1 } = segmentPoints(i);
      if (mx >= x0 && mx <= x1) { if(onClick) onClick(i); break; }
    }
  };
}

// ─────────────────────────────────────────────────────────────
//  8. DIBUJO: Gráfico polar / cartesiano de sección transversal
// ─────────────────────────────────────────────────────────────
function drawSectionChart(canvas, section, dnom, tol, title) {
  const W = canvas.offsetWidth || 380;
  const H = canvas.height || 360;
  canvas.width = W;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  const cx = W/2, cy = H/2;
  const maxR = Math.min(W, H)/2 - 38;
  const mode = section.inputMode || 'cartesian';
  const pts = section.points || [];

  if (!pts.length) {
    ctx.fillStyle = '#2a3855';
    ctx.font = '13px Barlow, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Sin puntos — ingresa mediciones', cx, cy);
    return;
  }

  // Calcular regresión circular
  let cartPts, fit;
  if (mode === 'cartesian') {
    cartPts = pts.filter(p => p.x !== undefined && p.y !== undefined);
  } else {
    cartPts = polarToCart(pts);
  }

  fit = cartPts.length >= 3 ? circularRegression(cartPts) : null;

  const fitR  = fit ? fit.r : dnom/2;
  const fitCx = fit ? fit.cx : 0;
  const fitCy = fit ? fit.cy : 0;
  const scale = r => (r / (fitR * 1.12)) * maxR;

  // ── Grid rings ──
  [0.85, 0.92, 0.97, 1.0, 1.03, 1.08, 1.12].forEach(f => {
    ctx.beginPath();
    ctx.arc(cx, cy, scale(fitR*f), 0, Math.PI*2);
    if (f === 1.0) {
      ctx.strokeStyle = 'rgba(0,212,255,0.3)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5,3]);
    } else {
      ctx.strokeStyle = '#0e1520';
      ctx.lineWidth = 0.4;
      ctx.setLineDash([3,4]);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  });

  // ── Radial guides ──
  for (let a = 0; a < 360; a += 15) {
    const rad = a * Math.PI/180;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + scale(fitR*1.12)*Math.cos(rad), cy + scale(fitR*1.12)*Math.sin(rad));
    ctx.strokeStyle = '#0b1020'; ctx.lineWidth = 0.3; ctx.stroke();
  }

  // ── Angle labels ──
  [0,45,90,135,180,225,270,315].forEach(a => {
    const rad = a*Math.PI/180, lr = scale(fitR*1.12)+15;
    ctx.fillStyle = '#1e2a40';
    ctx.font = '10px DM Mono, monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(a+'°', cx+lr*Math.cos(rad), cy+lr*Math.sin(rad));
  });

  // ── Tolerance band ──
  const tolR = fitR * tol/100;
  ctx.beginPath();
  ctx.arc(cx, cy, scale(fitR + tolR), 0, Math.PI*2, false);
  ctx.arc(cx, cy, scale(fitR - tolR), 0, Math.PI*2, true);
  ctx.fillStyle = 'rgba(245,197,24,0.04)';
  ctx.fill();
  [fitR+tolR, fitR-tolR].forEach(r2 => {
    ctx.beginPath(); ctx.arc(cx, cy, scale(r2), 0, Math.PI*2);
    ctx.strokeStyle='rgba(245,197,24,0.2)'; ctx.lineWidth=1; ctx.stroke();
  });

  // ── Nominal circle (r = dnom/2) ──
  ctx.beginPath();
  ctx.arc(cx, cy, scale(dnom/2), 0, Math.PI*2);
  ctx.strokeStyle = 'rgba(99,102,241,0.35)';
  ctx.lineWidth = 1; ctx.setLineDash([6,3]); ctx.stroke(); ctx.setLineDash([]);

  if (!fit) {
    ctx.fillStyle='#2a3855'; ctx.font='12px Barlow,sans-serif'; ctx.textAlign='center';
    ctx.fillText('Mínimo 3 puntos para regresión', cx, H-20);
    return;
  }

  // ── Fitted circle ──
  const fCx = cx + scale(fitCx);
  const fCy = cy + scale(fitCy);
  ctx.beginPath();
  ctx.arc(fCx, fCy, scale(fitR), 0, Math.PI*2);
  const ov = (fit.ovalityPct||0);
  const col = ovColor(ov, tol);
  ctx.strokeStyle = hexA(col, 0.6);
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // ── Measured points ──
  const ptsToPlot = mode==='cartesian' ? cartPts : cartPts;
  ptsToPlot.forEach((pt, i) => {
    // Plot actual point
    const px = cx + scale(pt.x);
    const py = cy + scale(pt.y);
    // Distance from fitted center
    const dist = Math.sqrt((pt.x-fitCx)**2+(pt.y-fitCy)**2);
    const dev = dist - fitR;
    const dotCol = Math.abs(dev) > fitR*0.01 ? (dev>0?'#ff4d4d':'#60a5fa') : '#39e07a';

    // Residual line from fitted circle
    const ang = Math.atan2(pt.y-fitCy, pt.x-fitCx);
    const circPx = fCx + scale(fitR)*Math.cos(ang);
    const circPy = fCy + scale(fitR)*Math.sin(ang);
    ctx.beginPath(); ctx.moveTo(circPx, circPy); ctx.lineTo(px, py);
    ctx.strokeStyle = hexA(dotCol, 0.4); ctx.lineWidth = 0.8; ctx.stroke();

    // Point
    ctx.beginPath(); ctx.arc(px, py, 5.5, 0, Math.PI*2);
    ctx.fillStyle = dotCol;
    ctx.fill(); ctx.strokeStyle='#07090c'; ctx.lineWidth=1.5; ctx.stroke();

    // Label
    const lr = Math.sqrt((px-cx)**2+(py-cy)**2) + 16;
    const la = Math.atan2(py-cy, px-cx);
    ctx.fillStyle = '#4a5a7a';
    ctx.font = '9px DM Mono, monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const labelTxt = mode==='cartesian'
      ? `(${pt.x.toFixed(1)},${pt.y.toFixed(1)})`
      : `${dist.toFixed(1)}`;
    ctx.fillText(labelTxt, cx+lr*Math.cos(la), cy+lr*Math.sin(la));
  });

  // ── Fitted center cross ──
  ctx.strokeStyle='rgba(0,212,255,0.7)'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(fCx-8,fCy); ctx.lineTo(fCx+8,fCy); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(fCx,fCy-8); ctx.lineTo(fCx,fCy+8); ctx.stroke();
  ctx.beginPath(); ctx.arc(fCx,fCy,3,0,Math.PI*2);
  ctx.fillStyle='#00d4ff'; ctx.fill();

  // Nominal center cross
  ctx.strokeStyle='rgba(99,102,241,0.4)'; ctx.lineWidth=0.8;
  ctx.beginPath(); ctx.moveTo(cx-6,cy); ctx.lineTo(cx+6,cy); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx,cy-6); ctx.lineTo(cx,cy+6); ctx.stroke();

  // ── Info overlay ──
  const infoX = 10, infoY = H-72;
  ctx.fillStyle='rgba(7,9,12,0.7)';
  ctx.fillRect(infoX, infoY, 160, 68);
  ctx.strokeStyle='#1a2236'; ctx.lineWidth=0.5; ctx.strokeRect(infoX,infoY,160,68);
  ctx.font='10px DM Mono, monospace'; ctx.textAlign='left'; ctx.textBaseline='top';
  ctx.fillStyle=col;
  ctx.fillText(`Ovalidad: ${ov.toFixed(4)}%`, infoX+8, infoY+8);
  ctx.fillStyle='#4a5a7a';
  ctx.fillText(`R ajustado: ${fitR.toFixed(3)} mm`, infoX+8, infoY+22);
  ctx.fillText(`Centro: (${fitCx.toFixed(2)}, ${fitCy.toFixed(2)})`, infoX+8, infoY+36);
  ctx.fillText(`RMSE: ${fit.rmse.toFixed(4)} mm`, infoX+8, infoY+50);

  // ── Legend ──
  ctx.font='10px Barlow, sans-serif'; ctx.textAlign='left'; ctx.textBaseline='alphabetic';
  ctx.fillStyle='rgba(0,212,255,0.5)';  ctx.fillText('─── Círculo ajustado', W-145, H-50);
  ctx.fillStyle='rgba(99,102,241,0.5)'; ctx.fillText('─ ─ Diámetro nominal', W-145, H-35);
  ctx.fillStyle='rgba(245,197,24,0.5)'; ctx.fillText(`···  Tolerancia ±${tol}%`, W-145, H-20);
}

// ─────────────────────────────────────────────────────────────
//  9. Demo data generator
// ─────────────────────────────────────────────────────────────
function generateDemoSection(dnom, ovalityPct) {
  const r = dnom/2;
  const n = 5;
  // Generar puntos que producen ovalidad deseada
  const points = [];
  const stretch = r * ovalityPct/100 / 2;
  for (let i=0; i<n; i++) {
    const angle = (i/n)*2*Math.PI + Math.random()*0.2;
    const rx = r + stretch * Math.cos(2*angle) + (Math.random()-0.5)*r*0.002;
    const ry = r;
    points.push({
      x: parseFloat((rx*Math.cos(angle) + (Math.random()-0.5)*2).toFixed(2)),
      y: parseFloat((ry*Math.sin(angle) + (Math.random()-0.5)*2).toFixed(2))
    });
  }
  return { inputMode:'cartesian', points };
}

window.KS = {
  circularRegression,
  cartToPolar,
  polarToCart,
  calcSectionMetrics,
  maxOvalityProject,
  projectStatusLevel,
  ovColor,
  hexA,
  drawKilnCylinder,
  drawSectionChart,
  generateDemoSection
};
