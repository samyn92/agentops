FROM golang:1.25 AS builder
ARG TARGETOS
ARG TARGETARCH

WORKDIR /workspace
COPY go.mod go.sum ./
RUN go mod download
COPY internal/ internal/
COPY channels/gitlab-label/ channels/gitlab-label/

RUN CGO_ENABLED=0 GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH} go build -a -o channel-gitlab-label ./channels/gitlab-label/cmd/

FROM gcr.io/distroless/static:nonroot
WORKDIR /
COPY --from=builder /workspace/channel-gitlab-label .
USER 65532:65532
ENTRYPOINT ["/channel-gitlab-label"]
