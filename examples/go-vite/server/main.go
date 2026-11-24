package main

import (
	"embed"
	"io/fs"
	"log"
	"net/http"
)

// embeddedFiles contains the Markdown resources and generated Vite assets.
//
//go:embed content web/dist
var embeddedFiles embed.FS

// main serves the embedded frontend and content resources over HTTP.
func main() {
	contentFS, err := fs.Sub(embeddedFiles, "content")
	if err != nil {
		log.Fatal(err)
	}

	webFS, err := fs.Sub(embeddedFiles, "web/dist")
	if err != nil {
		log.Fatal(err)
	}

	mux := http.NewServeMux()
	mux.Handle("/content/", http.StripPrefix("/content/", http.FileServer(http.FS(contentFS))))
	mux.Handle("/", http.FileServer(http.FS(webFS)))

	log.Println("Comark example listening on http://localhost:8081")
	log.Fatal(http.ListenAndServe("127.0.0.1:8081", mux))
}
