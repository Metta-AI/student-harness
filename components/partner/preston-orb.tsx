"use client";

import { useEffect, useRef } from "react";

const vertexSource = `
attribute vec2 position;
varying vec2 uv;
void main() { uv = position * .5 + .5; gl_Position = vec4(position, 0., 1.); }
`;

// Independent noise fields change the silhouette and gentle internal currents.
// Time advances locally, so pausing never jumps ahead on resume.
const fragmentSource = `
precision highp float;
varying vec2 uv;
uniform sampler2D wisp;
uniform float time;
uniform float aspect;
float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float noise(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(mix(hash(i), hash(i+vec3(1,0,0)), f.x),
                 mix(hash(i+vec3(0,1,0)), hash(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i+vec3(0,0,1)), hash(i+vec3(1,0,1)), f.x),
                 mix(hash(i+vec3(0,1,1)), hash(i+vec3(1,1,1)), f.x), f.y), f.z);
}
float field(vec3 p) { return .57*noise(p) + .28*noise(p*2.03+7.1) + .15*noise(p*4.07-3.2); }
mat2 rotate(float a) { return mat2(cos(a), -sin(a), sin(a), cos(a)); }
void main() {
  float t = time;
  vec2 p = (uv-.5)*vec2(aspect,1.);
  p.y -= .008*sin(t*.43);
  float radius = length(p);
  vec2 flow = vec2(field(vec3(p*5.,t*.14)), field(vec3(p.yx*5.+8.,-t*.11))) - .5;
  float pulse = 1. + .025*sin(t*.71) + .018*sin(t*.37);
  vec2 q = rotate(.04*sin(t*.21)) * p / pulse;
  q += flow * .09 * (1.-smoothstep(.3,.63,radius));
  vec2 texUv = q + .5;
  vec3 color = texture2D(wisp, clamp(texUv,0.,1.)).rgb;
  // Flowing light is drawn independently of the illustrated texture.
  float angle = atan(p.y,p.x);
  float turbulence = field(vec3(p*4.+flow,t*.16));
  float ribbon = abs(sin(angle*2.+radius*15.-t*.34+turbulence*4.));
  float wisps = pow(1.-ribbon,6.) * smoothstep(.09,.23,radius) * (1.-smoothstep(.3,.5,radius));
  vec3 jade = vec3(.68,.81,.57);
  color += jade * wisps * (.025 + .035*turbulence);
  float glow = exp(-length(p+flow*.1)*15.);
  color += vec3(.83,.71,.40)*glow*(.035+.025*sin(t*.64));
  color *= .97+.035*turbulence+.012*sin(t*.43+radius*6.);
  vec3 background = vec3(.894,.918,.859);
  color = mix(background,color,1.-smoothstep(.40,.66,radius));
  gl_FragColor = vec4(color,1.);
}
`;

export function PrestonOrb({ motion, busy }: { motion: boolean; busy: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const settings = useRef({ motion, busy });
  const reconcile = useRef<(() => void) | null>(null);

  useEffect(() => {
    settings.current = { motion, busy };
    reconcile.current?.();
  }, [motion, busy]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const gl = canvas.getContext("webgl", { alpha: false, antialias: false, powerPreference: "low-power" });
    if (!gl) return; // The illustrated wisp remains visible without WebGL.
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
      gl.deleteShader(shader);
      return null;
    };
    const vertex = compile(gl.VERTEX_SHADER, vertexSource);
    const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
    const program = gl.createProgram();
    if (!vertex || !fragment || !program) {
      gl.deleteShader(vertex); gl.deleteShader(fragment); gl.deleteProgram(program);
      return;
    }
    gl.attachShader(program, vertex); gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex); gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { gl.deleteProgram(program); return; }
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const timeUniform = gl.getUniformLocation(program, "time");
    const aspectUniform = gl.getUniformLocation(program, "aspect");
    const textures: WebGLTexture[] = [];
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let disposed = false, lost = false, ready = false, visible = false;
    let frame = 0, previous = 0, elapsed = 0;
    let width = 1, height = 1;
    const draw = () => {
      if (!ready || lost || disposed) return;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform1f(timeUniform, elapsed);
      gl.uniform1f(aspectUniform, width / height);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      canvas.dataset.ready = "true";
    };
    const animate = (now: number) => {
      frame = requestAnimationFrame(animate);
      if (!previous) { previous = now; return; }
      if (now - previous < 1000 / 30) return;
      elapsed += Math.min((now - previous) / 1000, .1) * (settings.current.busy ? 1.2 : 1);
      previous = now;
      draw();
    };
    const sync = () => {
      cancelAnimationFrame(frame); frame = 0; previous = 0;
      if (ready && !lost && !disposed && visible && !document.hidden && settings.current.motion && !reducedMotion.matches) {
        frame = requestAnimationFrame(animate);
      }
    };
    reconcile.current = sync;
    const resize = new ResizeObserver(([entry]) => {
      width = Math.max(1, entry.contentRect.width); height = Math.max(1, entry.contentRect.height);
      const scale = Math.min(window.devicePixelRatio || 1, 1.5, 512 / Math.max(width, height));
      canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale);
      draw();
    });
    resize.observe(canvas);
    const intersection = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); });
    intersection.observe(canvas);
    const contextLost = () => { lost = true; delete canvas.dataset.ready; sync(); };
    canvas.addEventListener("webglcontextlost", contextLost);
    reducedMotion.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    const images = ["preston-kindred-wisp"].map(name => {
      const image = new Image(); image.src = `/preston/${name}.webp`; return image;
    });
    Promise.all(images.map(image => image.decode())).then(() => {
      if (disposed || lost) return;
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      images.forEach((image, i) => {
        const texture = gl.createTexture()!; textures.push(texture);
        gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        gl.uniform1i(gl.getUniformLocation(program, "wisp"), i);
      });
      ready = true; draw(); sync();
    }).catch(() => { /* Keep the static fallback if an image cannot load. */ });
    return () => {
      disposed = true; cancelAnimationFrame(frame); reconcile.current = null;
      resize.disconnect(); intersection.disconnect();
      reducedMotion.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
      canvas.removeEventListener("webglcontextlost", contextLost);
      delete canvas.dataset.ready;
      textures.forEach(texture => gl.deleteTexture(texture));
      gl.deleteBuffer(buffer); gl.deleteProgram(program);
    };
  }, []);

  return <div className="preston-orb" aria-hidden="true">
    <img className="preston-orb-poster" src="/preston/preston-kindred-wisp.webp" width={768} height={768} alt="" draggable={false} />
    <canvas ref={canvasRef} className="preston-orb-canvas" />
  </div>;
}
