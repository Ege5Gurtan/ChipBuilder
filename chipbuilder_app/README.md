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

Nine numbered missions plus the Process Sandbox teach carrier movement, signal delivery, lithography, etching, deposition, CMP, explicit logic-gate timing, copper interconnects, and tungsten contacts. The removed 05 and 11 slots are intentionally absent so the remaining mission numbers keep their existing references. WASD always controls the carrier while fabrication remains available with the mouse. Enter delivers collected cargo at DEST.

## Level 08: Explicit NOT gate timing

Level 08 uses the same explicit gate rule as newer logic gates: NOT has a physical IN contact, a physical OUT contact, and a propagation delay. Load the 0 into IN, watch the progress bar fill, then collect the inverted 1 from OUT. Walking through this NOT gate does not flip cargo.

## Level 09: Add a Contact to the Wire

Level 09 no longer has SRC. A longer copper wire is already connected to NOT IN and extends away from the gate. The player chooses any tile on that wire, patterns it, **Deposits Tungsten**, and sets the new contact to **Drive**. There is no DRIVE marker or placeholder ring on the wafer. Send the collected 0 from the new contact into NOT, wait for the propagation delay, collect 1 at OUT, and carry it to DEST.

## Level 10: Connect the Driver

Level 10 also has no SRC. It starts with a normal functional tungsten contact sitting directly on one copper tile, with its role pre-set to Drive. It has no DRIVE map label and no gray placeholder/source ring. There is deliberately no copper connection from that contact to NOT IN; the player must fabricate that copper trench/trace using lithography, etch, and copper fill. Send 0 through the completed trace, then collect the resulting 1 at OUT and carry it to DEST.

Copper is passive and joins only across shared tile edges. Explicit Drive/Receive roles define direction for mission contacts that use manual pin roles. Gate inputs are receivers and gate outputs are drivers. Gate processing, wire packets, signal state, and win conditions live in gameplay state rather than the renderer.

Tungsten on flush copper at height 1 becomes a functional wire contact; tungsten elsewhere is electrically inactive. The terrain format can also supply a prebuilt tungsten contact, which Level 10 uses for its starting Drive contact.

The rules and level data are independent of rendering: `gameRules.js` owns gameplay and circuit state, `circuit.js` derives nets/routes, `terrain.js` defines terrain and costs, `levels.js` defines missions, and `ThreeScene.js` renders the wafer and handles input.

Run `CI=true npm test -- --watchAll=false --runInBand` for circuit and gameplay regression checks, and `CI=true npm run build` for production validation.
