/**
 * Tiny WebGL2 layer: two shader programs (lit triangles, coloured lines) and
 * dynamic vertex buffers. Geometry is built on the CPU with
 * {@link TriangleBuilder} / {@link LineBuilder} and uploaded whenever it
 * changes; the scenes are small enough that this is cheap.
 */

import type { Vec3, Winding } from "../../core";
import type { Rgba } from "./colors";
import type { Mat4 } from "./mat4";

const TRI_VS = `#version 300 es
in vec3 aPos;
in vec3 aNormal;
in vec4 aColor;
uniform mat4 uViewProj;
uniform vec3 uLight;
out vec4 vColor;
void main() {
  vec3 n = normalize(aNormal);
  float light = 0.5 + 0.35 * max(dot(n, uLight), 0.0) + 0.15 * abs(n.z);
  vColor = vec4(aColor.rgb * light, aColor.a);
  gl_Position = uViewProj * vec4(aPos, 1.0);
}`;

const LINE_VS = `#version 300 es
in vec3 aPos;
in vec4 aColor;
uniform mat4 uViewProj;
out vec4 vColor;
void main() {
  vColor = aColor;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}`;

const FS = `#version 300 es
precision mediump float;
in vec4 vColor;
out vec4 outColor;
void main() { outColor = vColor; }`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`Shader error: ${gl.getShaderInfoLog(s)}`);
  return s;
}

function program(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`Program link error: ${gl.getProgramInfoLog(p)}`);
  return p;
}

/** A vertex buffer + VAO for one interleaved format. */
export class GpuMesh {
  private readonly vao: WebGLVertexArrayObject;
  private readonly vbo: WebGLBuffer;
  private count = 0;

  constructor(private readonly gl: WebGL2RenderingContext, prog: WebGLProgram, attributes: readonly { name: string; size: number }[]) {
    this.vao = gl.createVertexArray()!;
    this.vbo = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    const stride = attributes.reduce((s, a) => s + a.size, 0) * 4;
    let offset = 0;
    for (const a of attributes) {
      const loc = gl.getAttribLocation(prog, a.name);
      if (loc >= 0) {
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, a.size, gl.FLOAT, false, stride, offset);
      }
      offset += a.size * 4;
    }
    this.floatsPerVertex = stride / 4;
    gl.bindVertexArray(null);
  }

  private readonly floatsPerVertex: number;

  upload(data: Float32Array): void {
    const { gl } = this;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    this.count = data.length / this.floatsPerVertex;
  }

  draw(mode: number): void {
    if (this.count === 0) return;
    this.gl.bindVertexArray(this.vao);
    this.gl.drawArrays(mode, 0, this.count);
    this.gl.bindVertexArray(null);
  }
}

export class GlContext {
  readonly triProgram: WebGLProgram;
  readonly lineProgram: WebGLProgram;

  constructor(readonly gl: WebGL2RenderingContext) {
    this.triProgram = program(gl, TRI_VS, FS);
    this.lineProgram = program(gl, LINE_VS, FS);
  }

  triangleMesh(): GpuMesh {
    return new GpuMesh(this.gl, this.triProgram, [{ name: "aPos", size: 3 }, { name: "aNormal", size: 3 }, { name: "aColor", size: 4 }]);
  }

  lineMesh(): GpuMesh {
    return new GpuMesh(this.gl, this.lineProgram, [{ name: "aPos", size: 3 }, { name: "aColor", size: 4 }]);
  }

  useTriangles(viewProj: Mat4, light: Vec3): void {
    const { gl } = this;
    gl.useProgram(this.triProgram);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.triProgram, "uViewProj"), false, viewProj);
    gl.uniform3f(gl.getUniformLocation(this.triProgram, "uLight"), light.x, light.y, light.z);
  }

  useLines(viewProj: Mat4): void {
    const { gl } = this;
    gl.useProgram(this.lineProgram);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.lineProgram, "uViewProj"), false, viewProj);
  }
}

/** Accumulates triangle-fan polygons (position, normal, colour). */
export class TriangleBuilder {
  private data: number[] = [];

  polygon(w: Winding, n: Vec3, c: Rgba): void {
    for (let i = 1; i + 1 < w.length; i++) {
      for (const p of [w[0], w[i], w[i + 1]]) this.data.push(p.x, p.y, p.z, n.x, n.y, n.z, c[0], c[1], c[2], c[3]);
    }
  }

  build(): Float32Array {
    return new Float32Array(this.data);
  }
}

/** Accumulates line segments (position, colour). */
export class LineBuilder {
  private data: number[] = [];

  segment(a: Vec3, b: Vec3, c: Rgba): void {
    this.data.push(a.x, a.y, a.z, c[0], c[1], c[2], c[3], b.x, b.y, b.z, c[0], c[1], c[2], c[3]);
  }

  loop(w: Winding, c: Rgba): void {
    for (let i = 0; i < w.length; i++) this.segment(w[i], w[(i + 1) % w.length], c);
  }

  build(): Float32Array {
    return new Float32Array(this.data);
  }
}
