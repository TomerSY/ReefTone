const SHADER = `
struct Settings {
  exposure: f32,
  contrast: f32,
  redRecovery: f32,
  temperature: f32,
  tint: f32,
  saturation: f32,
  padding0: f32,
  padding1: f32,
}

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;
@group(0) @binding(2) var<uniform> settings: Settings;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@vertex
fn vertexMain(@builtin(vertex_index) index: u32) -> VertexOutput {
  var positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0)
  );
  var uvs = array<vec2<f32>, 3>(
    vec2<f32>(0.0, 1.0),
    vec2<f32>(2.0, 1.0),
    vec2<f32>(0.0, -1.0)
  );
  var output: VertexOutput;
  output.position = vec4<f32>(positions[index], 0.0, 1.0);
  output.uv = uvs[index];
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  var color = textureSample(sourceTexture, sourceSampler, input.uv);
  let redGap = max(0.0, color.g - color.r);
  color.r += redGap * settings.redRecovery * 0.72 * (1.0 - color.r) * (0.35 + color.g);

  let warmth = settings.temperature * 0.28;
  let tint = settings.tint * 0.22;
  color.r *= 1.0 + warmth + tint * 0.48;
  color.g *= 1.0 - tint;
  color.b *= 1.0 - warmth + tint * 0.34;

  color.rgb *= exp2(settings.exposure);
  color.rgb = (color.rgb - vec3<f32>(0.5)) * (1.0 + settings.contrast) + vec3<f32>(0.5);

  let luminance = dot(color.rgb, vec3<f32>(0.2126, 0.7152, 0.0722));
  color.rgb = mix(vec3<f32>(luminance), color.rgb, 1.0 + settings.saturation);
  return vec4<f32>(clamp(color.rgb, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
`;

export class WebGpuRenderer {
  static async create(canvas) {
    if (!navigator.gpu) throw new Error("WebGPU is unavailable");
    const adapter = await navigator.gpu.requestAdapter({powerPreference: "high-performance"});
    if (!adapter) throw new Error("No WebGPU adapter");
    const device = await adapter.requestDevice();
    return new WebGpuRenderer(canvas, adapter, device);
  }

  constructor(canvas, adapter, device) {
    this.canvas = canvas;
    this.adapter = adapter;
    this.device = device;
    this.context = canvas.getContext("webgpu");
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.module = device.createShaderModule({code: SHADER});
    this.pipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: {module: this.module, entryPoint: "vertexMain"},
      fragment: {
        module: this.module,
        entryPoint: "fragmentMain",
        targets: [{format: this.format}],
      },
      primitive: {topology: "triangle-list"},
    });
    this.sampler = device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
    });
    this.uniformBuffer = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.texture = null;
    this.bindGroup = null;
  }

  async setImage(bitmap) {
    this.texture?.destroy();
    this.canvas.width = bitmap.width;
    this.canvas.height = bitmap.height;
    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: "opaque",
    });
    this.texture = this.device.createTexture({
      size: [bitmap.width, bitmap.height],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING
        | GPUTextureUsage.COPY_DST
        | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.device.queue.copyExternalImageToTexture(
      {source: bitmap},
      {texture: this.texture},
      [bitmap.width, bitmap.height],
    );
    this.bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        {binding: 0, resource: this.texture.createView()},
        {binding: 1, resource: this.sampler},
        {binding: 2, resource: {buffer: this.uniformBuffer}},
      ],
    });
  }

  render(settings) {
    if (!this.bindGroup) return;
    const values = new Float32Array([
      settings.exposure,
      settings.contrast,
      settings.redRecovery,
      settings.temperature,
      settings.tint,
      settings.saturation,
      0,
      0,
    ]);
    this.device.queue.writeBuffer(this.uniformBuffer, 0, values);
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        clearValue: {r: 0.01, g: 0.02, b: 0.02, a: 1},
        loadOp: "clear",
        storeOp: "store",
      }],
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  describe() {
    const maxTexture = this.device.limits.maxTextureDimension2D;
    return {
      name: "WebGPU",
      detail: `GPU preview · ${maxTexture}px texture limit`,
    };
  }
}
