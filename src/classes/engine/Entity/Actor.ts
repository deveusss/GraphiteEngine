import { Transform } from "../Math/Transform.js";
import { Material } from "../Render/Material.js";
import { Mesh } from "../Render/Mesh.js";

export class Actor
{
    private static actors: Actor[] = [];

    protected transform: Transform;
    private mesh: Mesh;
    private material: Material;

    public constructor()
    {
        Actor.actors.push(this);

        this.transform = new Transform();
        this.mesh = new Mesh();
        this.material = new Material();
    }
    
    public update(): void {};

    public static getActors(): Actor[]
    {
        return Actor.actors;
    }

    public getMesh(): Mesh
    {
        return this.mesh;
    }

    public getMaterial(): Material
    {
        return this.material;
    }

    public getTransform(): Transform
    {
        return this.transform;
    }

    protected setMesh(mesh: Mesh): void
    {
        this.mesh = mesh;
    }

    protected setMaterial(material: Material): void
    {
        this.material = material;
    }
}