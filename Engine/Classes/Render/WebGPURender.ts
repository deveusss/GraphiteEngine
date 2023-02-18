import { Actor } from "../Entity/Actor.js";
import { Matrix4 } from "../Math/Matrix4.js";
import { Vector3 } from "../Math/Vector3.js";
import { RenderingCanvas } from "./RenderingCanvas.js";
import { Vertex } from "./Vertex.js";
import { WebGPUCamera } from "./WebGPUCamera.js";
import { WebGPUMesh } from "./WebGPUMesh.js";

let vertexShader = `
struct VertexOutput 
{
    @builtin(position) vertPosition : vec4<f32>,
    @location(0) uv : vec2<f32>,
};

@vertex
fn main(@location(0) position: vec3<f32>) -> VertexOutput
{
    var output : VertexOutput;
    output.vertPosition = vec4<f32>(position, 1.0);
    output.uv = position.xy;
    return output;
}`;

let fragmentShader = `
@group(0) @binding(0) var texture : texture_2d<f32>;
@group(0) @binding(1) var samp : sampler;

@fragment
fn main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32>
{
    let coord = vec2<f32>((uv.x + 1.0) / 2.0, (1.0 - uv.y) / 2.0);
    let color = textureSample(texture, samp, coord);
    return sqrt(color);
}`;

export class WebGPURenderer
{
    private usePostProcessing: boolean;

    private renderingCanvas: RenderingCanvas;
    private postProcessingRenderingCanvas: RenderingCanvas;
    private gpu: GPU;

    private adapter: GPUAdapter | null;
    private device: GPUDevice | null;
    private context: GPUCanvasContext | null;
    private postProcessingContext: GPUCanvasContext | null;
    private postProcessingPipeline: GPURenderPipeline | null;
    private depthView: GPUTextureView | null;

    private quadMesh: WebGPUMesh;
    private sampler: GPUSampler | null;

    private primitiveTopology: GPUPrimitiveTopology;

    /**
     * Creates a new WebGPURenderer.
     */
    public constructor()
    {
        this.usePostProcessing              = false;
        this.device                         = null;
        this.adapter                        = null;
        this.context                        = null;
        this.postProcessingContext          = null;
        this.postProcessingPipeline         = null;
        this.depthView                      = null;
        this.sampler                        = null;
        this.renderingCanvas                = new RenderingCanvas();
        this.postProcessingRenderingCanvas  = new RenderingCanvas();
        this.quadMesh                       = this.setupQuadMesh();
        this.gpu                            = this.setupGPU();

        this.renderingCanvas.displayCanvas();

        this.setup();
        
        this.primitiveTopology = "triangle-list";
    }

    /**
     * Finalizes the setup of a renderer.
     */
    private finalize(device: GPUDevice): void
    {
        this.device                 = device;
        this.context                = this.setupContext(device, this.renderingCanvas.getCanvas());
        this.postProcessingContext  = this.setupContext(device, this.postProcessingRenderingCanvas.getCanvas());
        this.postProcessingPipeline = this.setupPostProcessingPipeline(device);
        this.depthView              = this.setupDepthView(device);
        this.quadMesh               = this.setupQuadMesh();
        this.sampler                = this.setupSampler(device);

        this.resize(device);
        window.addEventListener("resize", this.resize.bind(this, device));
    }

    /**
     * Renders an actor using a camera.
     */
    private renderActor(actor: Actor, camera: WebGPUCamera, passEncoder: GPURenderPassEncoder, device: GPUDevice): void
    {
        let pipeline: GPURenderPipeline;
        let vertexBuffer: GPUBuffer;
        let mActorBuffer: GPUBuffer;
        let mViewBuffer: GPUBuffer;
        let mProjBuffer: GPUBuffer;
        let mActorRotBuffer: GPUBuffer;
        let uniformBindingGroup: GPUBindGroup;

        pipeline                = this.getActorPipeline(actor);
        vertexBuffer            = actor.getMesh().getVertexBuffer(device);
        mActorBuffer            = this.toUniformGPUBuffer(device, actor.getTransform().getTransformationMatrix());
        mViewBuffer             = this.toUniformGPUBuffer(device, camera.getTransform().getViewTransformationMatrix());
        mProjBuffer             = camera.getProjectionBuffer(device);
        mActorRotBuffer         = this.toUniformGPUBuffer(device, actor.getTransform().getRotationMatrix());
        uniformBindingGroup     = this.setupUniformBindGroup(device, pipeline, 0, mActorBuffer, mViewBuffer, mProjBuffer, mActorRotBuffer);

        this.draw(passEncoder, pipeline, actor.getMesh(), vertexBuffer, uniformBindingGroup);
    }

    /**
     * Renders post-processing effects.
     */
    private renderPostProcessing(device: GPUDevice, context: GPUCanvasContext, depthView: GPUTextureView, pipeline: GPURenderPipeline, frameTexture: GPUTexture, sampler: GPUSampler): void
    {
        let commandEncoder: GPUCommandEncoder;
        let view: GPUTextureView;
        let passEncoder: GPURenderPassEncoder;
        let uniformBindingGroup: GPUBindGroup;
        let vertexBuffer: GPUBuffer;

        commandEncoder          = device.createCommandEncoder();
        view                    = this.getTextureView(context);
        passEncoder             = this.getPassEncoder(commandEncoder, view, depthView);
        uniformBindingGroup     = this.setupUniformBindGroup(device, pipeline, 0, frameTexture, sampler);
        vertexBuffer            = this.quadMesh.getVertexBuffer(device);

        this.draw(passEncoder, pipeline, this.quadMesh, vertexBuffer, uniformBindingGroup);
        passEncoder.end();
        device.queue.submit([commandEncoder.finish()]);
    }

    /**
     * Draws.
     */
    private draw(passEncoder: GPURenderPassEncoder, pipeline: GPURenderPipeline, mesh:WebGPUMesh, vertexBuffer: GPUBuffer, ...uniformBindingGroups: Array<GPUBindGroup>): void
    {
        passEncoder.setPipeline(pipeline);
        passEncoder.setVertexBuffer(0, vertexBuffer);
        for(let uniformBindingGroup of uniformBindingGroups) passEncoder.setBindGroup(0, uniformBindingGroup);
        passEncoder.draw(mesh.getVertices().length / (3 + 2 + 3)); /** POSITION UV NORMAL */
    }

    /**
     * Render an array of actors using a specific camera.
     */
    public render(actors: Actor[], camera: WebGPUCamera): void
    {
        if(!this.device 
        || !this.context 
        || !this.depthView)
            return;

        let commandEncoder: GPUCommandEncoder;
        let view: GPUTextureView;
        let passEncoder: GPURenderPassEncoder;

        commandEncoder  = this.device.createCommandEncoder();
        view            = this.getTextureView(this.context);
        passEncoder     = this.getPassEncoder(commandEncoder, view, this.depthView);

        for(let actor of actors) if(actor != camera)
            this.renderActor(actor, camera, passEncoder, this.device);

        passEncoder.end();
        this.device.queue.submit([commandEncoder.finish()]);
    }

    /**
     * Setups the quad mesh used for post-processing.
     */
    private setupQuadMesh(): WebGPUMesh
    {
        let quadMesh: WebGPUMesh;

        quadMesh = new WebGPUMesh();
        quadMesh.addVertex(
            new Vertex(new Vector3(-1.0,  1.0, 0.0)),
            new Vertex(new Vector3(-1.0, -1.0, 0.0)),
            new Vertex(new Vector3( 1.0, -1.0, 0.0)),
            new Vertex(new Vector3(-1.0,  1.0, 0.0)),
            new Vertex(new Vector3( 1.0,  1.0, 0.0)),
            new Vertex(new Vector3( 1.0, -1.0, 0.0)),
        );

        return quadMesh;
    }

    /**
     * Setups a renderer.
     */
    private setup(): void
    {
        this.setupAdapter()
        .then(function(this: WebGPURenderer, adapter: GPUAdapter)
        {
            this.adapter = adapter;
            this.setupDevice(this.adapter).then(this.finalize.bind(this));
        }.bind(this));
    }

    /**
     * Setups a sampler.
     */
    private setupSampler(device: GPUDevice): GPUSampler
    {
        return device.createSampler({magFilter: 'linear', minFilter: 'linear'});
    }

    /**
     * Setups a depth texture.
     */
    private setupDepthTexture(device: GPUDevice, canvas:HTMLCanvasElement): GPUTexture
    {
        let depthTexture: GPUTexture;
        depthTexture = device.createTexture(
        {   size: {width: canvas.width, height: canvas.height}, 
            format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT
        });

        return depthTexture;
    }

    /**
     * Setups a depth view.
     */
    private setupDepthView(device: GPUDevice): GPUTextureView
    {
        let depthTexture: GPUTexture;
        let depthView: GPUTextureView;

        depthTexture = this.setupDepthTexture(device, this.renderingCanvas.getCanvas());
        depthView = depthTexture.createView();

        return depthView;
    }

    /**
     * Setups the gpu.
     */
    private setupGPU(): GPU
    {
        let gpu: GPU;
        gpu = navigator.gpu;
        if(!gpu) throw new Error("Can't get the GPU");

        return gpu;
    }

    /**
     * Setups an adapter.
     */
    private async setupAdapter(): Promise<GPUAdapter>
    {
        let adapter: GPUAdapter | null;
        adapter = await this.gpu.requestAdapter({powerPreference: "high-performance"});
        if(!adapter) throw new Error("Can't get adapter");

        return adapter;
    }

    /**
     * Setups a device.
     */
    private async setupDevice(adapter: GPUAdapter): Promise<GPUDevice>
    {
        let device: GPUDevice | undefined;
        device = await adapter.requestDevice();
        if(!device) throw new Error("Can't get device");

        return device;
    }

    /**
     * Setups a context.
     */
    private setupContext(device: GPUDevice, canvas: HTMLCanvasElement): GPUCanvasContext
    {
        let context: GPUCanvasContext | null;
        context = canvas.getContext("webgpu");
        if(!context) throw new Error("Can't get context");
        context.configure(this.getContextConfig(device));

        return context;
    }

    /**
     * Resizes a renderer.
     */
    private resize(device: GPUDevice): void
    {
        this.renderingCanvas.resize();
        this.postProcessingRenderingCanvas.resize();
        this.depthView = this.setupDepthView(device);
    }

    /**
     * Gets a context config.
     */
    private getContextConfig(device: GPUDevice): GPUCanvasConfiguration
    {
        return {
            device: device,
            format: this.gpu.getPreferredCanvasFormat(),
            alphaMode: "opaque",
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC
        };
    }

    /**
     * Gets the renderer pipeline of an actor.
     */
    private getActorPipeline(actor: Actor): GPURenderPipeline
    {
        return actor.getMaterial().getRenderPipeline(this);
    }

    /**
     * Gets the primitive topology of a renderer.
     */
    public getPrimitiveTopology(): GPUPrimitiveTopology
    {
        return this.primitiveTopology;
    }

    /**
     * Gets the device of a renderer.
     */
    public getDevice(): GPUDevice
    {
        if(!this.device) throw new Error("Error: Device not found");
        return this.device;
    }

    /**
     * Gets the gpu of a renderer.
     */
    public getGPU(): GPU
    {
        return this.gpu;
    }

    /**
     * Gets the rendering canvas of a renderer.
     */
    public getRenderingCanvas(): RenderingCanvas
    {
        return this.renderingCanvas;
    }

    /**
     * Gets the post-processing rendering canvas of a renderer.
     */
    public getPostProcessingRenderingCanvas(): RenderingCanvas
    {
        return this.postProcessingRenderingCanvas;
    }

    /**
     * Generates a buffer from an iterable.
     */
    private toUniformGPUBuffer(device: GPUDevice, iterable: Float32Array): GPUBuffer
    {
        let buffer: GPUBuffer;
        buffer = device.createBuffer({size: iterable.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
        device.queue.writeBuffer(buffer, 0, iterable);
        
        return buffer;
    }

    /**
     * Gets a texture from the last render.
     */
    private getTextureFromRender(device: GPUDevice, canvas: HTMLCanvasElement, commandEncoder:GPUCommandEncoder, swapChainTexture: GPUTexture): GPUTexture
    {
        let texture: GPUTexture;

        texture = device.createTexture({size: {width: canvas.width, height: canvas.height}, 
            format: this.gpu.getPreferredCanvasFormat(), 
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST});
        commandEncoder.copyTextureToTexture({texture: swapChainTexture}, {texture: texture}, [canvas.width, canvas.height]);
        
        return texture;
    }

    /**
     * Gets a view from the last render.
     */
    private getTextureView(context: GPUCanvasContext): GPUTextureView
    {
        return context.getCurrentTexture().createView();
    }

    /**
     * Gets a pass encoder.
     */
    private getPassEncoder(commandEncoder: GPUCommandEncoder, view: GPUTextureView, depthView: GPUTextureView): GPURenderPassEncoder
    {
        let renderPassDescriptor: GPURenderPassDescriptor;

        renderPassDescriptor = {
            colorAttachments: [
                {
                    view: view,
                    clearValue: {r: 0.09, g: 0.09, b: 0.09, a: 1.0},
                    loadOp: "clear",
                    storeOp: "store"
                }
            ],
            depthStencilAttachment: {
                view: depthView,
                depthClearValue: 1.0,
                depthLoadOp: 'clear',
                depthStoreOp: 'store',
            }
        }

        return commandEncoder.beginRenderPass(renderPassDescriptor);
    }

    /**
     * Setups a post-processing rendering pipeline.
     */
    private setupPostProcessingPipeline(device: GPUDevice): GPURenderPipeline
    {
        let pipeline: GPURenderPipeline;
        pipeline = device.createRenderPipeline(
            {
                layout: "auto",
                vertex: {
                    entryPoint: "main",
                    module: device.createShaderModule(
                        {
                            code: vertexShader
                        }
                    ),
                    buffers: [
                        {
                            attributes: [
                                {
                                    shaderLocation: 0,
                                    format: "float32x3",
                                    offset: 0
                                },
                                {
                                    shaderLocation: 1,
                                    format: "float32x2",
                                    offset: 3 * 4
                                },
                                {
                                    shaderLocation: 2,
                                    format: "float32x3",
                                    offset: (3 + 2) * 4
                                },
                            ],
                            stepMode: "vertex",
                            arrayStride: (3 + 2 + 3) * 4
                        }
                    ]
                }, 
                fragment: {
                    entryPoint: "main",
                    module: device.createShaderModule(
                        {
                            code: fragmentShader
                        }
                    ),
                    targets: [
                        {
                            format: this.gpu.getPreferredCanvasFormat()
                        }
                    ]
                },
                primitive: {
                    topology: this.getPrimitiveTopology()
                },
                depthStencil: {
                    depthWriteEnabled: true,
                    depthCompare: 'less',
                    format: 'depth24plus',
                }
            }
        );

        return pipeline;
    }

    /**
     * Gets a bind-group entry resource from a buffer, a texture or a sampler.
     */
    private getBindGroupEntryResource(entry: GPUBuffer | GPUTexture | GPUSampler): GPUBindingResource
    {        
        if(entry instanceof GPUBuffer)
            return {buffer: entry};

        if(entry instanceof GPUTexture)
            return entry.createView();

        return entry;
    }

    /**
     * Setups a bind group used for uniforms.
     */
    private setupUniformBindGroup(device: GPUDevice, pipeline: GPURenderPipeline, bindingIndex:number, ...buffers: Array<GPUBuffer | GPUTexture | GPUSampler>): GPUBindGroup
    {
        let entries: Array<GPUBindGroupEntry>;
        entries = new Array<GPUBindGroupEntry>();

        for(let i = 0; i < buffers.length; i++) 
            entries.push({binding: i, resource: this.getBindGroupEntryResource(buffers[i])});

        return device.createBindGroup({layout: pipeline.getBindGroupLayout(bindingIndex), entries: entries});
    }

    /**
     * Sets the use of post-processing.
     */
    public setUsePostProcessing(use: boolean): void
    {
        this.usePostProcessing = use;
        if(use)
        {   
            this.renderingCanvas.hideCanvas();
            this.postProcessingRenderingCanvas.displayCanvas();
        }
        else
        {
            this.renderingCanvas.displayCanvas();
            this.postProcessingRenderingCanvas.hideCanvas();
        }
    }
}