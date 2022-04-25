// setup file
import Adapter from '@wojtekmaj/enzyme-adapter-react-17'

const { configure } = require('enzyme')

configure({ adapter: new Adapter() })
