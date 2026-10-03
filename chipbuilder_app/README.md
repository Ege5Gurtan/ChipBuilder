# Getting Started with Create React App

This project was bootstrapped with [Create React App](https://github.com/facebook/create-react-app).

## Available Scripts

In the project directory, you can run:

### `npm start`

Runs the app in the development mode.\
Open [http://localhost:3000](http://localhost:3000) to view it in your browser.

The page will reload when you make changes.\
You may also see any lint errors in the console.

### `npm test`

Launches the test runner in the interactive watch mode.\
See the section about [running tests](https://facebook.github.io/create-react-app/docs/running-tests) for more information.

### `npm run build`

Builds the app for production to the `build` folder.\
It correctly bundles React in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.\
Your app is ready to be deployed!

See the section about [deployment](https://facebook.github.io/create-react-app/docs/deployment) for more information.

### `npm run eject`

**Note: this is a one-way operation. Once you `eject`, you can't go back!**

If you aren't satisfied with the build tool and configuration choices, you can `eject` at any time. This command will remove the single build dependency from your project.

Instead, it will copy all the configuration files and the transitive dependencies (webpack, Babel, ESLint, etc) right into your project so you have full control over them. All of the commands except `eject` will still work, but they will point to the copied scripts so you can tweak them. At this point you're on your own.

You don't have to ever use `eject`. The curated feature set is suitable for small and middle deployments, and you shouldn't feel obligated to use this feature. However we understand that this tool wouldn't be useful if you couldn't customize it when you are ready for it.

## Learn More

You can learn more in the [Create React App documentation](https://facebook.github.io/create-react-app/docs/getting-started).

To learn React, check out the [React documentation](https://reactjs.org/).

### Code Splitting

This section has moved here: [https://facebook.github.io/create-react-app/docs/code-splitting](https://facebook.github.io/create-react-app/docs/code-splitting)

### Analyzing the Bundle Size

This section has moved here: [https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size](https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size)

### Making a Progressive Web App

This section has moved here: [https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app](https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app)

### Advanced Configuration

This section has moved here: [https://facebook.github.io/create-react-app/docs/advanced-configuration](https://facebook.github.io/create-react-app/docs/advanced-configuration)

### Deployment

This section has moved here: [https://facebook.github.io/create-react-app/docs/deployment](https://facebook.github.io/create-react-app/docs/deployment)

### `npm run build` fails to minify

This section has moved here: [https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify](https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify)
# Gameplay

Nine selectable missions teach carrier movement, signal delivery, lithography, etching, deposition, CMP, NOT logic, and copper interconnects. WASD always controls the carrier while the mouse paints fabrication patterns. K loads a nearby input/source or drops a cargo bit; Enter delivers collected cargo at DEST in every mission. Cargo can be reordered by dragging.

## Level 09: Wire the NOT Gate

1. Paint two separate horizontal traces on the row containing the pads: SRC to NOT IN, and NOT OUT to DEST. Include the tile beneath each pad. Do not join the two output drivers together.
2. Click **Etch patterned tiles**, then **Fill Copper in trenches**. Copper fills all height-0 trenches and automatically contacts any pad it reaches. This introductory process combines fill and flush finishing; manual contacts, vias, and wire CMP are future features.
3. Collect the 0. Select it and click SRC or the sidebar's send button, drag it onto SRC, or approach SRC and press K.
4. Watch the signal travel through the copper, invert at NOT, and deliver 1 automatically at DEST. The carrier does not need to move during transport. Alternatively, leave OUT unconnected, walk over the waiting output bit to collect it, carry it to DEST and press Enter. Walking through a wired gate does not invert cargo.

Copper is passive and joins only across shared tile edges. Ports determine direction. The circuit panel explains open connections, multiple-driver shorts, and feedback loops. Gate outputs wait for available receivers; fan-out sends one copy of a finite token to each receiver. A rejected destination value returns to cargo. Edits and undo pause while packets are in transit. Ctrl+Z refunds fabrication costs while preserving gameplay energy.

The rules and level data are independent of rendering: `gameRules.js` owns gameplay and circuit state, `circuit.js` derives nets/routes, `terrain.js` defines terrain and costs, `levels.js` defines missions, and `ThreeScene.js` renders the wafer and handles input.

Run `CI=true npm test -- --watchAll=false --runInBand` for circuit and gameplay regression checks, and `CI=true npm run build` for production validation.
