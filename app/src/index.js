"use strict";
exports.__esModule = true;
var react_1 = require("react");
var client_1 = require("react-dom/client");
var app_1 = require("./app");
var container = document.getElementById("app");
var root = (0, client_1.createRoot)(container);
root.render(<app_1["default"] />);
