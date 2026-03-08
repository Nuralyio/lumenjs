export interface ManifestLayout {
  dir: string;
  module: string;
  hasLoader: boolean;
}

export interface ManifestRoute {
  path: string;
  module: string;
  hasLoader: boolean;
  layouts?: string[];
}

export interface BuildManifest {
  routes: ManifestRoute[];
  apiRoutes: ManifestRoute[];
  layouts: ManifestLayout[];
}
