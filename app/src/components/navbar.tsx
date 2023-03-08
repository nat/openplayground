import React from "react"
import { Link } from "react-router-dom"

export default function NavBar({ tab, children }: any) {
  return (
    <div className="flex flex-col font-display mb-5 border">
      <div className="flex inline-block mx-5 my-4 gap-x-4 flex-wrap">
        <div className="align-middle mt-1">
          <Link to="/" className="">
            <p
              className={
                tab === "playground"
                  ? "text-xl font-medium underline underline-offset-[6px]"
                  : "text-xl font-medium"
              }
            >
              Playground
            </p>
          </Link>
        </div>

        <div className="align-middle mt-1">
          <Link to="/compare" className="">
            <p
              className={
                tab === "compare"
                  ? "text-xl font-medium underline underline-offset-[6px]"
                  : "text-xl font-medium"
              }
            >
              Compare
            </p>
          </Link>
        </div>

        <div className="mt-1">
          <Link to="/settings" className="">
            <p
              className={
                tab === "settings"
                  ? "text-xl font-medium underline underline-offset-[6px]"
                  : "text-xl font-medium"
              }
            >
              Settings
            </p>
          </Link>
        </div>
        {children}
      </div>
    </div>
  )
}
