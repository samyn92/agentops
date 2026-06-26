FROM golang:1.26 AS builder
ARG TARGETOS
ARG TARGETARCH

WORKDIR /workspace
COPY go.mod go.sum ./
RUN go mod download
COPY channels/ channels/

RUN CGO_ENABLED=0 GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH} go build -a -o channel-gitlab-comment ./channels/gitlab-comment/cmd/

FROM gcr.io/distroless/static:nonroot
WORKDIR /
COPY --from=builder /workspace/channel-gitlab-comment .
USER 65532:65532
ENTRYPOINT ["/channel-gitlab-comment"]
