package localtools

import (
	"bufio"
	"bytes"
	"encoding/json"
	"io"
	"os"
	"slices"
	"sort"
	"time"
)

// claude-tap has no MCP server upstream. This minimal stdio server speaks JSON-RPC 2.0,
// one message per line, and exposes two read-only tools that never read trace contents.

const (
	mcpLatestProtocol = "2025-06-18"
	maxListedTraces   = 20
)

var mcpProtocols = []string{"2024-11-05", "2025-03-26", "2025-06-18"}

type rpcRequest struct {
	ID     json.RawMessage `json:"id"`
	Method string          `json:"method"`
	Params json.RawMessage `json:"params"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type traceFile struct {
	Name  string `json:"name"`
	Bytes int64  `json:"bytes"`
	MTime string `json:"mtime"`
}

func serveTapMCP(t Tool, config string, stdin io.Reader, stdout io.Writer) error {
	scanner := bufio.NewScanner(stdin)
	scanner.Buffer(make([]byte, 64<<10), 4<<20)
	encoder := json.NewEncoder(stdout)
	for scanner.Scan() {
		line := bytes.TrimSpace(scanner.Bytes())
		if len(line) == 0 {
			continue
		}
		var req rpcRequest
		if err := json.Unmarshal(line, &req); err != nil {
			if err := encoder.Encode(map[string]any{"jsonrpc": "2.0", "id": nil, "error": rpcError{-32700, "parse error"}}); err != nil {
				return err
			}
			continue
		}
		// Notifications, such as notifications/initialized, carry no id and get no answer.
		if len(req.ID) == 0 || string(req.ID) == "null" {
			continue
		}
		result, failure := handleTapRequest(t, config, req)
		response := map[string]any{"jsonrpc": "2.0", "id": req.ID}
		if failure != nil {
			response["error"] = failure
		} else {
			response["result"] = result
		}
		if err := encoder.Encode(response); err != nil {
			return err
		}
	}
	return scanner.Err()
}

func handleTapRequest(t Tool, config string, req rpcRequest) (any, *rpcError) {
	switch req.Method {
	case "initialize":
		var params struct {
			ProtocolVersion string `json:"protocolVersion"`
		}
		_ = json.Unmarshal(req.Params, &params)
		version := mcpLatestProtocol
		if slices.Contains(mcpProtocols, params.ProtocolVersion) {
			version = params.ProtocolVersion
		}
		return map[string]any{
			"protocolVersion": version,
			"capabilities":    map[string]any{"tools": map[string]any{}},
			"serverInfo":      map[string]any{"name": TapName, "version": t.Version},
		}, nil
	case "ping":
		return map[string]any{}, nil
	case "tools/list":
		empty := map[string]any{"type": "object", "properties": map[string]any{}, "additionalProperties": false}
		readOnly := map[string]any{"readOnlyHint": true}
		return map[string]any{"tools": []any{
			map[string]any{"name": "claude_tap_status", "description": "Report whether claude-tap is installed and its live viewer is running, with the viewer URL and the traces directory.", "inputSchema": empty, "annotations": readOnly},
			map[string]any{"name": "claude_tap_list_traces", "description": "List up to 20 files of the claude-tap traces directory, newest first, with size and modification time. File contents are never read.", "inputSchema": empty, "annotations": readOnly},
		}}, nil
	case "tools/call":
		var params struct {
			Name string `json:"name"`
		}
		_ = json.Unmarshal(req.Params, &params)
		var payload any
		switch params.Name {
		case "claude_tap_status":
			payload = tapStatus(t, config)
		case "claude_tap_list_traces":
			files, err := listTraces(config)
			if err != nil {
				return toolResult(map[string]any{"error": err.Error()}, true), nil
			}
			payload = map[string]any{"traces_dir": TracesDir(config), "files": files}
		default:
			return nil, &rpcError{-32602, "unknown tool"}
		}
		return toolResult(payload, false), nil
	}
	return nil, &rpcError{-32601, "method not found"}
}

func toolResult(payload any, isError bool) map[string]any {
	text, _ := json.Marshal(payload)
	return map[string]any{"content": []any{map[string]any{"type": "text", "text": string(text)}}, "structuredContent": payload, "isError": isError}
}

func tapStatus(t Tool, config string) map[string]any {
	installed := t.Check(config) == nil
	version := ""
	if installed {
		version = t.Version
	}
	return map[string]any{
		"installed":  installed,
		"version":    version,
		"viewer_url": TapViewerURL(),
		"traces_dir": TracesDir(config),
		"running":    Listening(TapViewerAddr),
	}
}

// listTraces reads directory metadata only. A missing directory is an empty list.
func listTraces(config string) ([]traceFile, error) {
	entries, err := os.ReadDir(TracesDir(config))
	if os.IsNotExist(err) {
		return []traceFile{}, nil
	}
	if err != nil {
		return nil, err
	}
	type stamped struct {
		file traceFile
		at   time.Time
	}
	var all []stamped
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil || !info.Mode().IsRegular() {
			continue
		}
		all = append(all, stamped{traceFile{entry.Name(), info.Size(), info.ModTime().UTC().Format(time.RFC3339)}, info.ModTime()})
	}
	sort.SliceStable(all, func(i, j int) bool { return all[i].at.After(all[j].at) })
	files := []traceFile{}
	for i := 0; i < len(all) && i < maxListedTraces; i++ {
		files = append(files, all[i].file)
	}
	return files, nil
}
