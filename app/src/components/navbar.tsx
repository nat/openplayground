import React from "react"
import { Link } from "react-router-dom"

export default function NavBar({ tab, children }: any) {
  return (
    <div className="flex flex-col font-display mb-5 border">
      <div className="flex inline-block mx-5 my-4 gap-x-4 flex-wrap">
        <div className="align-middle mt-1 flex items-center">
          <Link to="/" className={
                tab === "playground"
                  ? "cursor-default"
                  : "cursor-pointer"
              }>
            <p
              className={
                tab === "playground"
                  ? "text-xl font-semibold"
                  : "text-xl font-medium text-gray-500 hover:text-gray-900"
              }
            >
              Playground
            </p>
          </Link>
        </div>

        <div className="align-middle mt-1 flex items-center">
          <Link to="/compare" className={
                tab === "compare"
                  ? "cursor-default"
                  : "cursor-pointer"
              }>
            <p
              className={
                tab === "compare"
                  ? "text-xl font-semibold"
                  : "text-xl font-medium text-gray-500 hover:text-gray-900"
              }
            >
              Compare
            </p>
          </Link>
        </div>
        <div className="align-middle mt-1 flex items-center">
          <Link to="/about" className={
                tab === "about"
                  ? "cursor-default"
                  : "cursor-pointer"
              }>
            <p
              className={
                tab === "about"
                  ? "text-xl font-semibold"
                  : "text-xl font-medium text-gray-500 hover:text-gray-900"
              }
            >
              About
            </p>
          </Link>
        </div>
        
        <div
          className = "ml-4 cursor-pointer flex justify-end items-center self-flex-end"
          onClick={() => {
            window.open("https://discord.gg/REgcyAfX", "_blank")
          }}
          >
          <img
            style = {{height: '20px'}}
            src= "https://assets-global.website-files.com/6257adef93867e50d84d30e2/636e0a6a49cf127bf92de1e2_icon_clyde_blurple_RGB.png"
          />
          </div>
        
        {children}
      </div>
    </div>
  )
}
