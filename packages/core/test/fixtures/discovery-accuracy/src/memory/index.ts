export class KnowledgeGraph {
  private nodes: Map<string, any> = new Map();
  async query(subject: string) { return this.nodes.get(subject); }
}
