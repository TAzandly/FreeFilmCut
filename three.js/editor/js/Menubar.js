import { UIPanel } from './libs/ui.js';

import { MenubarAdd } from './Menubar.Add.js?v=fcc-ui-188';
import { MenubarEdit } from './Menubar.Edit.js';
import { MenubarFile } from './Menubar.File.js?v=fcc-ui-220';
import { MenubarView } from './Menubar.View.js?v=fcc-ui-106';
import { MenubarRender } from './Menubar.Render.js?v=fcc-ui-232';
import { MenubarHelp } from './Menubar.Help.js';
import { MenubarStatus } from './Menubar.Status.js?v=fcc-ui-106';

function Menubar( editor ) {

	const container = new UIPanel();
	container.setId( 'menubar' );

	container.add( new MenubarFile( editor ) );
	container.add( new MenubarEdit( editor ) );
	container.add( new MenubarAdd( editor ) );
	container.add( new MenubarView( editor ) );
	container.add( new MenubarRender( editor ) );
	container.add( new MenubarHelp( editor ) );

	container.add( new MenubarStatus( editor ) );

	return container;

}

export { Menubar };
