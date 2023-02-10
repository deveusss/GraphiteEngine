export class Vector3
{
    public x: number;
    public y: number;
    public z: number;

    public constructor();
    public constructor(x: number, y: number, z: number);
    public constructor(x?: number, y?: number, z?: number)
    {
        this.x = x || 0.0;
        this.y = y || 0.0;
        this.z = z || 0.0;
    }

    public dot(vector: Vector3): number
    {
        return this.x * vector.x + this.y * vector.y + this.z * vector.z;
    }

    public getMagnitude(): number
    {
        return Math.sqrt(this.dot(this));
    }

    public add(vector: Vector3): Vector3
    {
        return new Vector3(this.x + vector.x, this.y + vector.y, this.z + vector.z);
    }

    public scale(x: number): Vector3
    {
        return new Vector3(this.x * x, this.y * x, this.z * x);
    }

    public substract(vector: Vector3): Vector3
    {
        return this.add(vector.scale(-1));
    }

    public divide(x: number): Vector3
    {
        return this.scale(1 / x);
    }

    public product(vector: Vector3): Vector3
    {
        return new Vector3(this.x * vector.x, this.y * vector.y, this.z * vector.z);
    }

    public cross(vector: Vector3): Vector3
    {
        return new Vector3(
            this.y * vector.z - this.z * vector.y, 
            this.z * vector.x - this.x * vector.z,
            this.x * vector.y - this.y * vector.x
        );
    }

    public toArray(): number[]
    {
        return [this.x, this.y, this.z];
    }
}