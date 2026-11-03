import { UISpan } from './libs/ui.js';

import { SidebarProjectApp } from './Sidebar.Project.App.js?v=fcc-ui-196';
import { SidebarProjectRenderer } from './Sidebar.Project.Renderer.js?v=fcc-ui-196';
import { SidebarProjectResources } from './Sidebar.Project.Resources.js?v=fcc-ui-159';
import { SidebarProjectResolution } from './Sidebar.Project.Resolution.js?v=fcc-ui-196';
import { SidebarProjectVfxPack } from './Sidebar.Project.VfxPack.js?v=fcc-ui-232';

function SidebarProject( editor ) {

	const container = new UISpan();

	container.add( new SidebarProjectResolution( editor ) );

	container.add( new SidebarProjectVfxPack( editor ) );

	container.add( new SidebarProjectRenderer( editor ) );

	container.add( new SidebarProjectApp( editor ) );

	container.add( new SidebarProjectResources( editor ) );

	return container;

}

export { SidebarProject };
