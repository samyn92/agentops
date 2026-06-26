FROM golang:1.26 AS builder
ARG TARGETOS
ARG TARGETARCH

WORKDIR /workspace
COPY go.mod ./
COPY internal/ internal/
COPY channels/webhook/ channels/webhook/

RUN CGO_ENABLED=0 GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH} go build -a -o channel-webhook ./channels/webhook/cmd/

FROM gcr.io/distroless/static:nonroot
WORKDIR /
COPY --from=builder /workspace/channel-webhook .
USER 65532:65532
ENTRYPOINT ["/channel-webhook"]
